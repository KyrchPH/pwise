import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { emitMessagingEvent } from './messaging.events.js';
import { hasMessagingAccess } from '../config/modules.js';

/**
 * Agent-to-agent connections ("friends"). A connection gates replying in A2A DMs:
 * a cold message auto-creates a pending request (see ensurePendingRequest), and the
 * receiver must accept before they can reply. One row per pair (requester→addressee),
 * status pending | accepted. Real-time over the shared messaging SSE bus.
 */

function toPerson(u) {
  return { id: Number(u.id), name: u.name || u.email || 'User', email: u.email || '' };
}

export async function areConnected(aId, bId) {
  if (Number(aId) === Number(bId)) return true;
  const rows = await query(
    "SELECT 1 FROM user_connections WHERE status='accepted' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)) LIMIT 1",
    [aId, bId, bId, aId],
  );
  return rows.length > 0;
}

// 'connected' | 'incoming' (they requested me) | 'outgoing' (I requested them) | 'none'
export async function relationship(actorId, otherId) {
  const rows = await query(
    'SELECT requester_id, status FROM user_connections WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?) LIMIT 1',
    [actorId, otherId, otherId, actorId],
  );
  if (!rows.length) return 'none';
  if (rows[0].status === 'accepted') return 'connected';
  return Number(rows[0].requester_id) === Number(actorId) ? 'outgoing' : 'incoming';
}

// Create a pending request from→to when no row exists between the pair. Idempotent;
// the A2A auto-request calls this when a non-connected DM is started/messaged.
export async function ensurePendingRequest(fromId, toId) {
  if (Number(fromId) === Number(toId)) return;
  const rows = await query(
    'SELECT id FROM user_connections WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?) LIMIT 1',
    [fromId, toId, toId, fromId],
  );
  if (rows.length) return;
  await query("INSERT INTO user_connections (requester_id, addressee_id, status) VALUES (?, ?, 'pending')", [fromId, toId]);
  emitMessagingEvent({ type: 'connection:request', fromUserId: Number(fromId) }, [Number(toId)]);
}

async function activeMessagingUser(id) {
  const rows = await query(
    'SELECT id, name, email, role, module_access FROM users WHERE id=? AND is_active=1 AND deleted_at IS NULL',
    [id],
  );
  if (!rows.length || !hasMessagingAccess(rows[0])) return null;
  return rows[0];
}

export async function accept(actor, otherId) {
  const other = Number(otherId);
  const res = await query(
    "UPDATE user_connections SET status='accepted', responded_at=NOW() WHERE requester_id=? AND addressee_id=? AND status='pending'",
    [other, actor.id],
  );
  if (!res.affectedRows) throw ApiError.badRequest('No pending request from that teammate.');
  emitMessagingEvent({ type: 'connection:changed', userId: Number(actor.id) }, [other, Number(actor.id)]);
  return { status: 'connected' };
}

export async function sendRequest(actor, targetId) {
  const target = Number(targetId);
  if (!Number.isFinite(target) || target === Number(actor.id)) throw ApiError.badRequest('invalid teammate');
  if (!(await activeMessagingUser(target))) throw ApiError.badRequest('That teammate is not available.');
  const rel = await relationship(actor.id, target);
  if (rel === 'connected') return { status: 'connected' };
  if (rel === 'outgoing') return { status: 'outgoing' };
  if (rel === 'incoming') return accept(actor, target); // they already asked → accept
  await query("INSERT INTO user_connections (requester_id, addressee_id, status) VALUES (?, ?, 'pending')", [actor.id, target]);
  emitMessagingEvent({ type: 'connection:request', fromUserId: Number(actor.id) }, [target]);
  return { status: 'outgoing' };
}

export async function decline(actor, otherId) {
  const other = Number(otherId);
  await query("DELETE FROM user_connections WHERE requester_id=? AND addressee_id=? AND status='pending'", [other, actor.id]);
  emitMessagingEvent({ type: 'connection:changed', userId: Number(actor.id) }, [other, Number(actor.id)]);
  return { status: 'none' };
}

export async function cancel(actor, otherId) {
  const other = Number(otherId);
  await query("DELETE FROM user_connections WHERE requester_id=? AND addressee_id=? AND status='pending'", [actor.id, other]);
  emitMessagingEvent({ type: 'connection:changed', userId: Number(actor.id) }, [other, Number(actor.id)]);
  return { status: 'none' };
}

export async function remove(actor, otherId) {
  const other = Number(otherId);
  await query(
    "DELETE FROM user_connections WHERE status='accepted' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))",
    [actor.id, other, other, actor.id],
  );
  emitMessagingEvent({ type: 'connection:changed', userId: Number(actor.id) }, [other, Number(actor.id)]);
  return { status: 'none' };
}

// Everything the Connections page needs in one call: accepted + pending in/out.
export async function listAll(actor) {
  const rows = await query(
    `SELECT c.requester_id, c.addressee_id, c.status,
            u.id AS uid, u.name, u.email
       FROM user_connections c
       JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END
      WHERE (c.requester_id = ? OR c.addressee_id = ?) AND u.is_active = 1 AND u.deleted_at IS NULL
      ORDER BY u.name ASC, u.email ASC`,
    [actor.id, actor.id, actor.id],
  );
  const connections = [];
  const incoming = [];
  const outgoing = [];
  for (const r of rows) {
    const person = toPerson({ id: r.uid, name: r.name, email: r.email });
    if (r.status === 'accepted') connections.push(person);
    else if (Number(r.requester_id) === Number(actor.id)) outgoing.push(person);
    else incoming.push(person);
  }
  return { connections, incoming, outgoing };
}

async function relationshipMap(actorId) {
  const rows = await query(
    'SELECT requester_id, addressee_id, status FROM user_connections WHERE requester_id=? OR addressee_id=?',
    [actorId, actorId],
  );
  const map = new Map();
  for (const r of rows) {
    const other = Number(r.requester_id) === Number(actorId) ? Number(r.addressee_id) : Number(r.requester_id);
    map.set(other, r.status === 'accepted' ? 'connected' : Number(r.requester_id) === Number(actorId) ? 'outgoing' : 'incoming');
  }
  return map;
}

// People search for the Connections page, each annotated with my relationship state.
export async function searchPeople(actor, q = '') {
  const term = `%${String(q || '').trim()}%`;
  const rows = await query(
    `SELECT id, name, email, role, module_access FROM users
      WHERE is_active=1 AND deleted_at IS NULL AND (name LIKE ? OR email LIKE ?)
      ORDER BY name ASC, email ASC LIMIT 30`,
    [term, term],
  );
  const map = await relationshipMap(actor.id);
  return rows
    .filter((u) => Number(u.id) !== Number(actor.id) && hasMessagingAccess(u))
    .map((u) => ({ ...toPerson(u), status: map.get(Number(u.id)) || 'none' }));
}
