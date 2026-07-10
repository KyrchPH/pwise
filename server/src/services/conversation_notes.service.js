import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { emitMessagingEvent } from './messaging.events.js';
import { maybeSendForConversation } from './surveys.service.js';

// Per-conversation notes — short, immutable, author-stamped context cards shown on
// the conversation view (a floating sticky + a side drawer). Plain text; links are
// fine (rendered clickable on the client) but there's no image/markup handling.
// Any Messaging user may create; notes can't be edited; only admins delete (gated at
// the route). Scoped by conversation_id — a note only exists within its thread.

const MAX_BODY = 5000;

function toSafe(r) {
  return {
    id: Number(r.id),
    conversationId: Number(r.conversation_id),
    body: r.body,
    createdBy: r.created_by != null ? Number(r.created_by) : null,
    createdByName: r.created_by_name || '',
    createdAt: r.created_at,
  };
}

function requireConversationId(conversationId) {
  const id = Number(conversationId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('a valid conversationId is required');
  return id;
}

// Audience for a conversation's note events: a bound (Live Agent) thread → just its
// owner; a shared (AI) thread → everyone (null). Mirrors the messages SSE scoping so
// a note on a private thread doesn't surface in other agents' inboxes.
async function audienceForConversation(conversationId) {
  const rows = await query('SELECT handled_by, assigned_user_id FROM conversations WHERE id = ?', [conversationId]);
  const c = rows[0];
  if (c && c.handled_by === 'Live Agent' && c.assigned_user_id != null) return [Number(c.assigned_user_id)];
  return null;
}

// A conversation's notes, newest first (the floating card defaults to the most recent
// and steps back through history).
export async function list(conversationId) {
  const id = Number(conversationId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const rows = await query(
    'SELECT * FROM conversation_notes WHERE conversation_id = ? ORDER BY created_at DESC, id DESC',
    [id],
  );
  return rows.map(toSafe);
}

export async function create(conversationId, actor = {}, data = {}) {
  const cid = requireConversationId(conversationId);
  const body = String(data.body ?? '').trim();
  if (!body) throw ApiError.badRequest('a note body is required');
  if (body.length > MAX_BODY) throw ApiError.badRequest(`a note can be at most ${MAX_BODY} characters`);

  // A clean 404 if the thread is gone (the FK would reject it anyway).
  const conv = await query('SELECT id FROM conversations WHERE id = ?', [cid]);
  if (!conv.length) throw ApiError.notFound('conversation not found');

  const result = await query(
    'INSERT INTO conversation_notes (conversation_id, body, created_by, created_by_name) VALUES (?, ?, ?, ?)',
    [cid, body, actor.id ?? null, actor.name || ''],
  );
  const rows = await query('SELECT * FROM conversation_notes WHERE id = ?', [result.insertId]);
  const note = toSafe(rows[0]);
  emitMessagingEvent({ type: 'note:new', conversationId: String(cid), note }, await audienceForConversation(cid));
  // A note marks the conversation completed → maybe survey the customer. Deliberately
  // fire-and-forget and SILENT: nothing about the roll or the send reaches the response
  // or the SSE stream, so the agent can never tell whether this customer was surveyed.
  maybeSendForConversation(cid, actor).catch((err) => console.warn('[surveys] send check failed:', err.message));
  return note;
}

// Delete a note. Admin-only — enforced by requireAdmin on the route. Notes are
// otherwise immutable (no update path exists).
export async function remove(id) {
  const nid = Number(id);
  const rows = await query('SELECT conversation_id FROM conversation_notes WHERE id = ?', [nid]);
  if (!rows.length) throw ApiError.notFound('note not found');
  const cid = Number(rows[0].conversation_id);
  await query('DELETE FROM conversation_notes WHERE id = ?', [nid]);
  emitMessagingEvent({ type: 'note:deleted', conversationId: String(cid), noteId: String(nid) }, await audienceForConversation(cid));
  return { id: nid, deleted: true };
}
