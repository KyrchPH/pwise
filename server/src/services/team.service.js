import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { emitMessagingEvent } from './messaging.events.js';
import { moduleAccessForUser } from '../config/modules.js';
import * as connections from './connections.service.js';

/**
 * Agent-to-agent chat — internal DMs and group chats between teammates. Separate
 * from customer conversations (own tables). Real-time updates ride the same SSE
 * bus as customer messaging (messaging.events), audience-scoped to participants,
 * with team:* event types the client handles distinctly.
 */

function hasMessagingAccess(user) {
  return user?.role === 'admin' || moduleAccessForUser(user).includes('messages');
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function humanizeSince(date) {
  if (!date) return '';
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatClock(date) {
  const d = date ? new Date(date) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function toMessageClient(row) {
  const media = parseJson(row.media, null);
  return {
    id: String(row.id),
    senderId: row.sender_user_id != null ? Number(row.sender_user_id) : null,
    sender: row.sender_name || '',
    text: row.body || '',
    media: Array.isArray(media) && media.length ? media : undefined,
    time: formatClock(row.created_at),
  };
}

// Build the client conversation shape. For a DM the display title is the OTHER
// participant's name; for a group it's the group name.
function toConversationClient(conv, participants, actorId, extra = {}) {
  const isGroup = !!conv.is_group;
  const members = participants.map((p) => ({
    id: Number(p.user_id),
    name: p.name || p.email || 'User',
    email: p.email || '',
  }));
  const others = members.filter((m) => m.id !== Number(actorId));
  const title = isGroup
    ? conv.name || 'Group chat'
    : others[0]?.name || 'Direct message';
  return {
    id: String(conv.id),
    isGroup,
    name: conv.name || '',
    title,
    participants: members,
    createdBy: conv.created_by != null ? Number(conv.created_by) : null,
    lastActivity: humanizeSince(conv.last_message_at),
    lastMessage: extra.lastMessage ?? '',
    unread: extra.unread ?? 0,
  };
}

async function assertParticipant(conversationId, userId) {
  const rows = await query(
    'SELECT 1 FROM agent_conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId],
  );
  if (!rows.length) throw new ApiError(403, 'You are not a participant in this conversation.');
}

async function loadParticipants(conversationId) {
  return query(
    `SELECT pp.user_id, pp.last_read_at, u.name, u.email
       FROM agent_conversation_participants pp
       LEFT JOIN users u ON u.id = pp.user_id
      WHERE pp.conversation_id = ?
      ORDER BY u.name ASC, u.email ASC`,
    [conversationId],
  );
}

async function participantIds(conversationId) {
  const rows = await query(
    'SELECT user_id FROM agent_conversation_participants WHERE conversation_id = ?',
    [conversationId],
  );
  return rows.map((r) => Number(r.user_id));
}

// Active, messaging-capable teammates matching a search term (excludes the actor).
export async function searchAgents(actor = {}, q = '') {
  const term = `%${String(q || '').trim()}%`;
  const rows = await query(
    `SELECT id, name, email, role, module_access FROM users
      WHERE is_active = 1 AND deleted_at IS NULL AND (name LIKE ? OR email LIKE ?)
      ORDER BY name ASC, email ASC LIMIT 30`,
    [term, term],
  );
  return rows
    .filter((u) => Number(u.id) !== Number(actor.id) && hasMessagingAccess(u))
    .map((u) => ({ id: Number(u.id), name: u.name || u.email, email: u.email }));
}

// All conversations the actor is in, newest first, with unread + last-message preview.
export async function listConversations(actor = {}) {
  const convs = await query(
    `SELECT c.*, p.last_read_at,
        (SELECT COUNT(*) FROM agent_messages m
           WHERE m.conversation_id = c.id
             AND m.sender_user_id <> ?
             AND m.created_at > COALESCE(p.last_read_at, '1970-01-01 00:00:00')) AS unread
       FROM agent_conversations c
       JOIN agent_conversation_participants p ON p.conversation_id = c.id AND p.user_id = ?
      ORDER BY c.last_message_at DESC, c.id DESC`,
    [actor.id ?? -1, actor.id ?? -1],
  );
  if (!convs.length) return [];

  const ids = convs.map((c) => c.id);
  const placeholders = ids.map(() => '?').join(',');
  const allParts = await query(
    `SELECT pp.conversation_id, pp.user_id, u.name, u.email
       FROM agent_conversation_participants pp
       LEFT JOIN users u ON u.id = pp.user_id
      WHERE pp.conversation_id IN (${placeholders})`,
    ids,
  );
  const lastMsgs = await query(
    `SELECT t.conversation_id, t.body, t.media FROM agent_messages t
       JOIN (SELECT conversation_id, MAX(id) AS mid FROM agent_messages
              WHERE conversation_id IN (${placeholders}) GROUP BY conversation_id) x
         ON x.mid = t.id`,
    ids,
  );

  const partsByConv = new Map();
  for (const p of allParts) {
    if (!partsByConv.has(p.conversation_id)) partsByConv.set(p.conversation_id, []);
    partsByConv.get(p.conversation_id).push(p);
  }
  const lastByConv = new Map(lastMsgs.map((m) => [m.conversation_id, m]));

  return convs.map((c) => {
    const last = lastByConv.get(c.id);
    const media = last ? parseJson(last.media, null) : null;
    const lastMessage = last
      ? last.body || (Array.isArray(media) && media.length ? `${media.length} attachment${media.length === 1 ? '' : 's'}` : '')
      : '';
    return toConversationClient(c, partsByConv.get(c.id) || [], actor.id, {
      unread: Number(c.unread) || 0,
      lastMessage,
    });
  });
}

// One thread with its full message history (participant-only).
export async function getConversation(id, actor = {}) {
  await assertParticipant(id, actor.id);
  const convRows = await query('SELECT * FROM agent_conversations WHERE id = ?', [id]);
  if (!convRows.length) throw ApiError.notFound('conversation not found');
  const participants = await loadParticipants(id);
  const msgs = await query(
    'SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
    [id],
  );
  const conv = toConversationClient(convRows[0], participants, actor.id);
  conv.messages = msgs.map(toMessageClient);
  // Connection gate metadata for DMs: the receiver can't reply until connected.
  if (!conv.isGroup) {
    const other = conv.participants.find((p) => p.id !== Number(actor.id));
    if (other) {
      const rel = await connections.relationship(actor.id, other.id);
      conv.connectionStatus = rel;
      conv.canReply = rel === 'connected' || Number(convRows[0].created_by) === Number(actor.id);
      conv.otherUserId = other.id;
      conv.otherUserName = other.name;
    } else {
      conv.canReply = true;
    }
  } else {
    conv.canReply = true;
  }
  return conv;
}

// Create a DM (reusing an existing one-on-one if present) or a named group.
export async function createConversation(actor = {}, { userIds = [], name = '', isGroup = false } = {}) {
  const memberIds = [
    ...new Set((userIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x !== Number(actor.id))),
  ];
  if (!memberIds.length) throw ApiError.badRequest('pick at least one teammate');

  const placeholders = memberIds.map(() => '?').join(',');
  const valid = await query(
    `SELECT id, name, email, role, module_access FROM users
      WHERE is_active = 1 AND deleted_at IS NULL AND id IN (${placeholders})`,
    memberIds,
  );
  const validIds = valid.filter((u) => hasMessagingAccess(u)).map((u) => Number(u.id));
  if (!validIds.length) throw ApiError.badRequest('no valid teammates selected');

  const group = !!isGroup || validIds.length > 1;

  if (!group) {
    const other = validIds[0];
    await connections.ensurePendingRequest(actor.id, other); // starting a DM = a connection request
    const existing = await query(
      `SELECT c.id FROM agent_conversations c
         JOIN agent_conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
         JOIN agent_conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
        WHERE c.is_group = 0
          AND (SELECT COUNT(*) FROM agent_conversation_participants pp WHERE pp.conversation_id = c.id) = 2
        LIMIT 1`,
      [actor.id, other],
    );
    if (existing.length) return getConversation(existing[0].id, actor);
  }

  const res = await query(
    'INSERT INTO agent_conversations (is_group, name, created_by, last_message_at) VALUES (?, ?, ?, NOW())',
    [group ? 1 : 0, group ? String(name || '').trim() || 'Group chat' : null, actor.id ?? null],
  );
  const convId = res.insertId;
  const allIds = [...new Set([Number(actor.id), ...validIds])];
  for (const uid of allIds) {
    await query('INSERT INTO agent_conversation_participants (conversation_id, user_id) VALUES (?, ?)', [convId, uid]);
  }
  const conv = await getConversation(convId, actor);
  emitMessagingEvent({ type: 'team:conversation:new', conversation: conv }, allIds);
  return conv;
}

// Post a message; broadcasts to all participants and bumps the thread's activity.
export async function sendMessage(id, actor = {}, { text, media } = {}) {
  await assertParticipant(id, actor.id);
  const cleanText = typeof text === 'string' ? text.trim() : '';
  const mediaList = Array.isArray(media)
    ? media.filter((m) => m && m.url).map((m) => ({ type: m.type || 'file', url: String(m.url), name: m.name || '' }))
    : [];
  if (!cleanText && !mediaList.length) throw ApiError.badRequest('a message body or media is required');

  // Connection gate (DMs only): a non-connected receiver can't reply; the initiator
  // can send, and that send auto-requests a connection.
  const cRows = await query('SELECT is_group, created_by FROM agent_conversations WHERE id = ?', [id]);
  if (cRows.length && !cRows[0].is_group) {
    const other = (await participantIds(id)).find((uid) => uid !== Number(actor.id));
    if (other != null && !(await connections.areConnected(actor.id, other))) {
      if (Number(cRows[0].created_by) !== Number(actor.id)) {
        throw new ApiError(403, 'You must be connected to this teammate to reply.');
      }
      await connections.ensurePendingRequest(actor.id, other);
    }
  }

  const res = await query(
    'INSERT INTO agent_messages (conversation_id, sender_user_id, sender_name, body, media) VALUES (?, ?, ?, ?, ?)',
    [id, actor.id ?? null, actor.name || actor.email || 'Agent', cleanText || null, mediaList.length ? JSON.stringify(mediaList) : null],
  );
  await query('UPDATE agent_conversations SET last_message_at = NOW() WHERE id = ?', [id]);
  // The sender has implicitly read up to their own message.
  await query('UPDATE agent_conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?', [id, actor.id]);

  const rows = await query('SELECT * FROM agent_messages WHERE id = ?', [res.insertId]);
  const message = toMessageClient(rows[0]);
  emitMessagingEvent({ type: 'team:message:new', conversationId: String(id), message }, await participantIds(id));
  return { message };
}

// Clear my unread for a thread.
export async function markSeen(id, actor = {}) {
  await assertParticipant(id, actor.id);
  await query('UPDATE agent_conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?', [id, actor.id]);
  return { ok: true };
}

async function requireGroup(id) {
  const c = await query('SELECT is_group FROM agent_conversations WHERE id = ?', [id]);
  if (!c.length) throw ApiError.notFound('conversation not found');
  if (!c[0].is_group) throw ApiError.badRequest('this action only applies to group chats');
}

export async function rename(id, actor = {}, name) {
  await assertParticipant(id, actor.id);
  await requireGroup(id);
  const clean = String(name || '').trim();
  if (!clean) throw ApiError.badRequest('a name is required');
  await query('UPDATE agent_conversations SET name = ? WHERE id = ?', [clean, id]);
  const conv = await getConversation(id, actor);
  emitMessagingEvent({ type: 'team:conversation:updated', conversation: conv }, conv.participants.map((p) => p.id));
  return conv;
}

export async function addParticipants(id, actor = {}, userIds = []) {
  await assertParticipant(id, actor.id);
  await requireGroup(id);
  const ids = [...new Set((userIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x))) ];
  if (!ids.length) throw ApiError.badRequest('pick at least one teammate');
  const placeholders = ids.map(() => '?').join(',');
  const valid = await query(
    `SELECT id, role, module_access FROM users WHERE is_active = 1 AND deleted_at IS NULL AND id IN (${placeholders})`,
    ids,
  );
  const newIds = valid.filter((u) => hasMessagingAccess(u)).map((u) => Number(u.id));
  for (const uid of newIds) {
    await query('INSERT IGNORE INTO agent_conversation_participants (conversation_id, user_id) VALUES (?, ?)', [id, uid]);
  }
  const conv = await getConversation(id, actor);
  emitMessagingEvent({ type: 'team:conversation:updated', conversation: conv }, conv.participants.map((p) => p.id));
  if (newIds.length) emitMessagingEvent({ type: 'team:conversation:new', conversation: conv }, newIds);
  return conv;
}

export async function removeParticipant(id, actor = {}, userId) {
  await assertParticipant(id, actor.id);
  await requireGroup(id);
  const target = Number(userId);
  if (target === Number(actor.id)) throw ApiError.badRequest('use leave to remove yourself');
  await query('DELETE FROM agent_conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, target]);
  const conv = await getConversation(id, actor);
  emitMessagingEvent({ type: 'team:conversation:updated', conversation: conv }, conv.participants.map((p) => p.id));
  emitMessagingEvent({ type: 'team:conversation:removed', conversationId: String(id) }, [target]);
  return conv;
}

export async function leave(id, actor = {}) {
  await assertParticipant(id, actor.id);
  await query('DELETE FROM agent_conversation_participants WHERE conversation_id = ? AND user_id = ?', [id, actor.id]);
  const remaining = await loadParticipants(id);
  if (remaining.length) {
    const convRows = await query('SELECT * FROM agent_conversations WHERE id = ?', [id]);
    const conv = toConversationClient(convRows[0], remaining, actor.id);
    emitMessagingEvent({ type: 'team:conversation:updated', conversation: conv }, remaining.map((p) => Number(p.user_id)));
  }
  emitMessagingEvent({ type: 'team:conversation:removed', conversationId: String(id) }, [Number(actor.id)]);
  return { ok: true };
}
