import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { emitMessagingEvent } from './messaging.events.js';

/**
 * Messaging inbox — shared/global customer chat threads per connected page.
 * Mirrors the frontend's conversation/message shape exactly so the UI can map
 * responses straight onto its state. Threads are internal-only for now (no live
 * platform ingestion); changes broadcast over SSE via messaging.events.
 */

// mysql2 returns JSON columns already parsed; guard for string configs anyway.
function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// "Just now" / "5m ago" / "3h ago" / "2d ago" — the relative label the list shows.
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

// "10:12 AM" — the per-bubble timestamp (server local time).
function formatClock(date) {
  const d = date ? new Date(date) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function rowToMessage(row) {
  const media = parseJson(row.media, null);
  const replyTo = parseJson(row.reply_to, null);
  return {
    id: String(row.id),
    side: row.side,
    sender: row.sender || '',
    time: formatClock(row.created_at),
    text: row.body || '',
    media: Array.isArray(media) && media.length ? media : undefined,
    replyTo: replyTo && replyTo.id ? replyTo : undefined,
  };
}

function rowToConversation(c, messageRows) {
  return {
    id: String(c.id),
    pageId: c.account_id != null ? String(c.account_id) : null,
    pageName: c.pa_name || c.page_name || '',
    customerName: c.customer_name || '',
    customerHandle: c.customer_handle || '',
    avatarUrl: c.customer_avatar || '',
    origin: c.origin || '',
    handledBy: c.handled_by,
    status: c.status || '',
    tags: parseJson(c.tags, []) || [],
    summary: c.summary || '',
    unread: Number(c.unread) || 0,
    activeMessages: messageRows.length,
    lastActivity: humanizeSince(c.last_message_at || c.updated_at),
    messages: messageRows.map(rowToMessage),
  };
}

// Lightweight mutable fields the client merges after an action / SSE event.
async function conversationPatch(id) {
  const rows = await query(
    'SELECT id, summary, unread, handled_by, status, last_message_at FROM conversations WHERE id = ?',
    [id],
  );
  if (!rows.length) return null;
  const c = rows[0];
  return {
    id: String(c.id),
    summary: c.summary || '',
    unread: Number(c.unread) || 0,
    handledBy: c.handled_by,
    status: c.status || '',
    lastActivity: humanizeSince(c.last_message_at),
  };
}

// Every thread, newest activity first, with its bubbles inline (dataset is small).
export async function listConversations() {
  const convs = await query(
    `SELECT c.*, pa.account_name AS pa_name
       FROM conversations c
       LEFT JOIN platform_accounts pa ON pa.id = c.account_id
      ORDER BY c.last_message_at DESC, c.id DESC`,
  );
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const msgs = await query(
    `SELECT * FROM messages WHERE conversation_id IN (${ids.map(() => '?').join(',')})
      ORDER BY created_at ASC, id ASC`,
    ids,
  );
  const byConv = new Map();
  for (const m of msgs) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  return convs.map((c) => rowToConversation(c, byConv.get(c.id) || []));
}

export async function getConversation(id) {
  const rows = await query(
    `SELECT c.*, pa.account_name AS pa_name
       FROM conversations c LEFT JOIN platform_accounts pa ON pa.id = c.account_id
      WHERE c.id = ?`,
    [id],
  );
  if (!rows.length) throw ApiError.notFound('conversation not found');
  const msgs = await query(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
    [id],
  );
  return rowToConversation(rows[0], msgs);
}

// Send a reply. Messenger-style: media goes out as its own bubble first, then the
// text as a separate bubble; the reply reference (if any) rides the first bubble.
export async function sendMessage(id, actor = {}, { text, media, replyTo } = {}) {
  const exists = await query('SELECT id FROM conversations WHERE id = ?', [id]);
  if (!exists.length) throw ApiError.notFound('conversation not found');

  const cleanText = typeof text === 'string' ? text.trim() : '';
  const mediaList = Array.isArray(media)
    ? media.filter((m) => m && m.url).map((m) => ({ type: m.type || 'file', url: String(m.url), name: m.name || '' }))
    : [];
  if (!cleanText && !mediaList.length) throw ApiError.badRequest('a message body or media is required');

  const reply =
    replyTo && replyTo.id ? { id: String(replyTo.id), sender: replyTo.sender || '', text: replyTo.text || '' } : null;

  const parts = [];
  if (mediaList.length) parts.push({ body: null, media: mediaList });
  if (cleanText) parts.push({ body: cleanText, media: null });

  const createdIds = [];
  for (let i = 0; i < parts.length; i += 1) {
    const result = await query(
      'INSERT INTO messages (conversation_id, side, sender, body, media, reply_to) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        'outgoing',
        actor.name || 'You',
        parts[i].body,
        parts[i].media ? JSON.stringify(parts[i].media) : null,
        i === 0 && reply ? JSON.stringify(reply) : null,
      ],
    );
    createdIds.push(result.insertId);
  }

  const summary = cleanText || `${mediaList.length} attachment${mediaList.length === 1 ? '' : 's'}`;
  await query('UPDATE conversations SET summary = ?, last_message_at = NOW() WHERE id = ?', [summary, id]);

  const rows = await query(
    `SELECT * FROM messages WHERE id IN (${createdIds.map(() => '?').join(',')}) ORDER BY created_at ASC, id ASC`,
    createdIds,
  );
  const messages = rows.map(rowToMessage);
  const conversation = await conversationPatch(id);
  emitMessagingEvent({ type: 'message:new', conversationId: String(id), messages, conversation });
  return { messages, conversation };
}

// Mark a thread seen (clears its unread count).
export async function markSeen(id) {
  const rows = await query('SELECT id, unread FROM conversations WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  if (Number(rows[0].unread) !== 0) await query('UPDATE conversations SET unread = 0 WHERE id = ?', [id]);
  const conversation = await conversationPatch(id);
  emitMessagingEvent({ type: 'conversation:updated', conversation });
  return conversation;
}

// Take over an AI thread → mark it handled by a live agent.
export async function takeOver(id) {
  const rows = await query('SELECT id, handled_by FROM conversations WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  if (rows[0].handled_by !== 'Live Agent') {
    await query("UPDATE conversations SET handled_by = 'Live Agent' WHERE id = ?", [id]);
  }
  const conversation = await conversationPatch(id);
  emitMessagingEvent({ type: 'conversation:updated', conversation });
  return conversation;
}
