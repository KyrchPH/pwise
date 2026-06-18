import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { emitMessagingEvent } from './messaging.events.js';
import { moduleAccessForUser } from '../config/modules.js';

// A Live Agent conversation is bound to one user — only that user may view/reply.
// AI Agent conversations are unbound (shared). Throws 403 on a bound chat the
// actor doesn't own.
function assertCanAccess(conv, actor) {
  if (conv.handled_by === 'Live Agent' && Number(conv.assigned_user_id) !== Number(actor?.id)) {
    throw new ApiError(403, 'This conversation is handled by another agent.');
  }
}

// SSE audience for a conversation's updates: a bound chat → just its owner; an
// unbound (AI) chat → everyone (null). Used so a Live Agent's messages aren't
// broadcast to other agents' browsers.
function audienceFor(conv) {
  return conv.handled_by === 'Live Agent' && conv.assigned_user_id != null
    ? [Number(conv.assigned_user_id)]
    : null;
}

function hasMessagingAccess(user) {
  return user?.role === 'admin' || moduleAccessForUser(user).includes('messages');
}

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
    assignedUserId: c.assigned_user_id != null ? Number(c.assigned_user_id) : null,
    assignedUserName: c.assigned_user_name || '',
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
    'SELECT id, summary, unread, handled_by, assigned_user_id, assigned_user_name, status, last_message_at FROM conversations WHERE id = ?',
    [id],
  );
  if (!rows.length) return null;
  const c = rows[0];
  return {
    id: String(c.id),
    summary: c.summary || '',
    unread: Number(c.unread) || 0,
    handledBy: c.handled_by,
    assignedUserId: c.assigned_user_id != null ? Number(c.assigned_user_id) : null,
    assignedUserName: c.assigned_user_name || '',
    status: c.status || '',
    lastActivity: humanizeSince(c.last_message_at),
  };
}

// Threads the actor may see: every AI Agent (shared) thread, plus the Live Agent
// threads bound to this user. Newest activity first, bubbles inline (small dataset).
export async function listConversations(actor = {}) {
  const convs = await query(
    `SELECT c.*, pa.account_name AS pa_name
       FROM conversations c
       LEFT JOIN platform_accounts pa ON pa.id = c.account_id
      WHERE c.handled_by <> 'Live Agent' OR c.assigned_user_id = ?
      ORDER BY c.last_message_at DESC, c.id DESC`,
    [actor.id ?? -1],
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

export async function getConversation(id, actor = {}) {
  const rows = await query(
    `SELECT c.*, pa.account_name AS pa_name
       FROM conversations c LEFT JOIN platform_accounts pa ON pa.id = c.account_id
      WHERE c.id = ?`,
    [id],
  );
  if (!rows.length) throw ApiError.notFound('conversation not found');
  assertCanAccess(rows[0], actor);
  const msgs = await query(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
    [id],
  );
  return rowToConversation(rows[0], msgs);
}

// Send a reply. Messenger-style: media goes out as its own bubble first, then the
// text as a separate bubble; the reply reference (if any) rides the first bubble.
export async function sendMessage(id, actor = {}, { text, media, replyTo } = {}) {
  const exists = await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE id = ?', [id]);
  if (!exists.length) throw ApiError.notFound('conversation not found');
  assertCanAccess(exists[0], actor); // only the bound agent may reply

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
  // Bound chat → only its owner's streams; AI chat → everyone.
  emitMessagingEvent({ type: 'message:new', conversationId: String(id), messages, conversation }, audienceFor(exists[0]));
  return { messages, conversation };
}

// Mark a thread seen (clears its unread count).
export async function markSeen(id, actor = {}) {
  const rows = await query('SELECT id, unread, handled_by, assigned_user_id FROM conversations WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  assertCanAccess(rows[0], actor);
  if (Number(rows[0].unread) !== 0) await query('UPDATE conversations SET unread = 0 WHERE id = ?', [id]);
  const conversation = await conversationPatch(id);
  emitMessagingEvent({ type: 'conversation:updated', conversation }, audienceFor(rows[0]));
  return conversation;
}

// Take over a thread → bind it to this user as the Live Agent. An AI thread can be
// taken by anyone; a Live thread already owned by someone else must be transferred
// (and accepted) instead. Broadcasts a reassignment so other agents drop it from
// their view (ids only — no message content leaves the owner's stream).
export async function takeOver(id, actor = {}) {
  const rows = await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  const c = rows[0];
  if (c.handled_by === 'Live Agent' && Number(c.assigned_user_id) !== Number(actor.id)) {
    throw new ApiError(403, 'This conversation is handled by another agent — request a transfer instead.');
  }
  await query(
    "UPDATE conversations SET handled_by = 'Live Agent', assigned_user_id = ?, assigned_user_name = ? WHERE id = ?",
    [actor.id ?? null, actor.name ?? null, id],
  );
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(id), assignedUserId: Number(actor.id) });
  return conversationPatch(id);
}

// ── Transfers (hand a conversation to another agent, who must accept) ─────────

// Teammates a conversation can be transferred to: active users with Messaging
// access, excluding the requester. Used by the transfer picker.
export async function listAgents(actor = {}) {
  const rows = await query(
    'SELECT id, name, email, role, module_access FROM users WHERE is_active = 1 AND deleted_at IS NULL ORDER BY name ASC, email ASC',
  );
  return rows
    .filter((u) => Number(u.id) !== Number(actor.id) && hasMessagingAccess(u))
    .map((u) => ({ id: Number(u.id), name: u.name || u.email, email: u.email }));
}

function transferToClient(t) {
  return {
    id: Number(t.id),
    conversationId: String(t.conversation_id),
    fromUserId: t.from_user_id != null ? Number(t.from_user_id) : null,
    fromUserName: t.from_user_name || '',
    toUserId: Number(t.to_user_id),
    toUserName: t.to_user_name || '',
    customerName: t.customer_name || '',
    customerHandle: t.customer_handle || '',
    avatarUrl: t.customer_avatar || '',
    origin: t.origin || '',
    pageName: t.pa_name || t.page_name || '',
    createdAt: t.created_at,
  };
}

async function loadTransfer(id) {
  const rows = await query(
    `SELECT t.*, c.customer_name, c.customer_handle, c.customer_avatar, c.origin, c.page_name, pa.account_name AS pa_name
       FROM conversation_transfers t
       JOIN conversations c ON c.id = t.conversation_id
       LEFT JOIN platform_accounts pa ON pa.id = c.account_id
      WHERE t.id = ?`,
    [id],
  );
  return rows[0] || null;
}

// Request to hand the conversation off to another agent. Only the current owner of
// a Live Agent chat may do this. The recipient must accept before ownership moves.
export async function requestTransfer(conversationId, actor = {}, toUserId) {
  const rows = await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE id = ?', [conversationId]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  const c = rows[0];
  if (c.handled_by !== 'Live Agent' || Number(c.assigned_user_id) !== Number(actor.id)) {
    throw new ApiError(403, 'Only the agent handling this conversation can transfer it.');
  }
  const target = Number(toUserId);
  if (!target || target === Number(actor.id)) throw ApiError.badRequest('Pick a teammate to transfer to.');
  const tRows = await query('SELECT id, name, role, module_access FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL', [target]);
  if (!tRows.length || !hasMessagingAccess(tRows[0])) throw ApiError.badRequest('That teammate is not available for messaging.');

  // One pending transfer per conversation — supersede any earlier pending one.
  await query("UPDATE conversation_transfers SET status = 'cancelled', responded_at = NOW() WHERE conversation_id = ? AND status = 'pending'", [conversationId]);
  const res = await query(
    "INSERT INTO conversation_transfers (conversation_id, from_user_id, from_user_name, to_user_id, to_user_name, status) VALUES (?, ?, ?, ?, ?, 'pending')",
    [conversationId, actor.id ?? null, actor.name ?? null, target, tRows[0].name ?? null],
  );
  const transfer = transferToClient(await loadTransfer(res.insertId));
  emitMessagingEvent({ type: 'transfer:new', transfer }, [target]); // only the recipient is notified
  return transfer;
}

// Pending transfers addressed to the current user (the incoming-request list).
export async function listIncomingTransfers(actor = {}) {
  const rows = await query(
    `SELECT t.*, c.customer_name, c.customer_handle, c.customer_avatar, c.origin, c.page_name, pa.account_name AS pa_name
       FROM conversation_transfers t
       JOIN conversations c ON c.id = t.conversation_id
       LEFT JOIN platform_accounts pa ON pa.id = c.account_id
      WHERE t.to_user_id = ? AND t.status = 'pending'
      ORDER BY t.created_at DESC`,
    [actor.id ?? -1],
  );
  return rows.map(transferToClient);
}

export async function acceptTransfer(transferId, actor = {}) {
  const t = await loadTransfer(transferId);
  if (!t) throw ApiError.notFound('transfer not found');
  if (Number(t.to_user_id) !== Number(actor.id)) throw new ApiError(403, 'This transfer is not addressed to you.');
  if (t.status !== 'pending') throw ApiError.badRequest('This transfer is no longer pending.');
  await query(
    "UPDATE conversations SET handled_by = 'Live Agent', assigned_user_id = ?, assigned_user_name = ? WHERE id = ?",
    [actor.id ?? null, actor.name ?? null, t.conversation_id],
  );
  await query("UPDATE conversation_transfers SET status = 'accepted', responded_at = NOW() WHERE id = ?", [transferId]);
  // Ownership changed — others drop it, the new owner's client fetches it (ids only).
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(t.conversation_id), assignedUserId: Number(actor.id) });
  emitMessagingEvent({ type: 'transfer:resolved', transferId: Number(transferId) }, [Number(t.to_user_id), Number(t.from_user_id)].filter(Boolean));
  return { id: Number(transferId), accepted: true, conversationId: String(t.conversation_id) };
}

export async function declineTransfer(transferId, actor = {}) {
  const t = await loadTransfer(transferId);
  if (!t) throw ApiError.notFound('transfer not found');
  if (Number(t.to_user_id) !== Number(actor.id)) throw new ApiError(403, 'This transfer is not addressed to you.');
  if (t.status !== 'pending') throw ApiError.badRequest('This transfer is no longer pending.');
  await query("UPDATE conversation_transfers SET status = 'declined', responded_at = NOW() WHERE id = ?", [transferId]);
  emitMessagingEvent({ type: 'transfer:resolved', transferId: Number(transferId) }, [Number(t.to_user_id), Number(t.from_user_id)].filter(Boolean));
  return { id: Number(transferId), declined: true };
}

// ── Inbound from n8n ─────────────────────────────────────────────────────────
// n8n (or any integration) delivers a message into a thread here: a customer's
// incoming message, or an AI-agent reply n8n generated. It appends the bubble(s),
// creating the thread if this is a new customer, bumps unread, and broadcasts over
// SSE so every open inbox updates live. Machine-authed (service token) — this is
// the inbound counterpart to sendMessage(), which is the browser/live-agent path.

// Look up a connected page by our id or its Facebook page id. Returns the row or
// null (a message can still land on a thread with no page attached).
async function resolveAccount({ accountId, fbPageId }) {
  if (accountId != null && accountId !== '') {
    const rows = await query('SELECT id, account_name FROM platform_accounts WHERE id = ?', [accountId]);
    if (rows.length) return rows[0];
  }
  if (fbPageId) {
    const rows = await query('SELECT id, account_name FROM platform_accounts WHERE fb_page_id = ? LIMIT 1', [fbPageId]);
    if (rows.length) return rows[0];
  }
  return null;
}

// Find the thread this inbound belongs to, or open a new one. Resolution order:
// explicit conversationId → existing (page, customer handle) pair → create. Returns
// { id, created }.
async function resolveOrCreateConversation(payload, account) {
  if (payload.conversationId != null && payload.conversationId !== '') {
    const rows = await query('SELECT id FROM conversations WHERE id = ?', [payload.conversationId]);
    if (!rows.length) throw ApiError.notFound('conversation not found');
    return { id: Number(rows[0].id), created: false };
  }

  const accountId = account?.id ?? null;
  const handle = payload.customerHandle ? String(payload.customerHandle).trim() : '';

  // A customer is identified within a page by their handle — reuse that thread.
  if (handle) {
    const rows =
      accountId != null
        ? await query(
            'SELECT id FROM conversations WHERE account_id = ? AND customer_handle = ? ORDER BY id DESC LIMIT 1',
            [accountId, handle],
          )
        : await query(
            'SELECT id FROM conversations WHERE account_id IS NULL AND customer_handle = ? ORDER BY id DESC LIMIT 1',
            [handle],
          );
    if (rows.length) return { id: Number(rows[0].id), created: false };
  }

  // New thread — needs a display name (fall back to the handle).
  const customerName = String(payload.customerName || '').trim() || handle || 'New customer';
  const result = await query(
    `INSERT INTO conversations
       (account_id, page_name, customer_name, customer_handle, customer_avatar, origin, handled_by, status, tags, summary, unread, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
    [
      accountId,
      account?.account_name || payload.pageName || null,
      customerName,
      handle || null,
      payload.customerAvatar || null,
      payload.origin || null,
      payload.handledBy === 'Live Agent' ? 'Live Agent' : 'AI Agent',
      payload.status || null,
      JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
      '', // summary is filled once the first message lands (below)
    ],
  );
  return { id: Number(result.insertId), created: true };
}

/**
 * Append an inbound message to a thread and broadcast it. `payload`:
 *   - target:   conversationId | (accountId|pageId|fbPageId) + customerHandle
 *   - message:  text and/or media:[{type,url,name}], optional replyTo, sender
 *   - side:     'incoming' (default, from the customer) | 'outgoing' (AI reply)
 *   - thread:   optional customerName/customerAvatar/origin/status/tags/handledBy
 *               (used when creating a thread), summary (overrides the auto one),
 *               incrementUnread (defaults: +1 for incoming, +0 for outgoing)
 * Mirrors sendMessage's bubble split (media first, then text). Returns
 * { conversationId, created, messages?, conversation }.
 */
export async function receiveInbound(payload = {}) {
  const cleanText = typeof payload.text === 'string' ? payload.text.trim() : '';
  const mediaList = Array.isArray(payload.media)
    ? payload.media.filter((m) => m && m.url).map((m) => ({ type: m.type || 'file', url: String(m.url), name: m.name || '' }))
    : [];
  if (!cleanText && !mediaList.length) throw ApiError.badRequest('a message body or media is required');

  const side = payload.side === 'outgoing' ? 'outgoing' : 'incoming';
  const account = await resolveAccount({ accountId: payload.accountId ?? payload.pageId, fbPageId: payload.fbPageId });
  const { id, created } = await resolveOrCreateConversation(payload, account);

  const reply =
    payload.replyTo && payload.replyTo.id
      ? { id: String(payload.replyTo.id), sender: payload.replyTo.sender || '', text: payload.replyTo.text || '' }
      : null;
  const sender = payload.sender || (side === 'incoming' ? payload.customerName || 'Customer' : 'AI Agent');

  // Media goes out as its own bubble first, then the text (Messenger-style); the
  // reply reference rides the first bubble.
  const parts = [];
  if (mediaList.length) parts.push({ body: null, media: mediaList });
  if (cleanText) parts.push({ body: cleanText, media: null });

  const createdIds = [];
  for (let i = 0; i < parts.length; i += 1) {
    const result = await query(
      'INSERT INTO messages (conversation_id, side, sender, body, media, reply_to) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        side,
        sender,
        parts[i].body,
        parts[i].media ? JSON.stringify(parts[i].media) : null,
        i === 0 && reply ? JSON.stringify(reply) : null,
      ],
    );
    createdIds.push(result.insertId);
  }

  // Refresh the thread's summary + activity time and bump unread. Incoming
  // customer messages mark the thread unread; AI replies don't, unless overridden.
  const summary = payload.summary || cleanText || `${mediaList.length} attachment${mediaList.length === 1 ? '' : 's'}`;
  let bump = side === 'incoming' ? 1 : 0;
  if (payload.incrementUnread === true) bump = 1;
  if (payload.incrementUnread === false) bump = 0;
  const sets = ['summary = ?', 'last_message_at = NOW()', 'unread = unread + ?'];
  const params = [summary, bump];
  if (payload.status) {
    sets.push('status = ?');
    params.push(payload.status);
  }
  if (payload.handledBy === 'AI Agent' || payload.handledBy === 'Live Agent') {
    sets.push('handled_by = ?');
    params.push(payload.handledBy);
  }
  params.push(id);
  await query(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, params);

  // Broadcast. A brand-new thread goes out as conversation:new with the FULL
  // conversation (so clients can insert it into the list); an existing thread just
  // gets its new bubbles via message:new.
  if (created) {
    const cRows = await query(
      `SELECT c.*, pa.account_name AS pa_name
         FROM conversations c LEFT JOIN platform_accounts pa ON pa.id = c.account_id WHERE c.id = ?`,
      [id],
    );
    const msgs = await query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC', [id]);
    const conversation = rowToConversation(cRows[0], msgs);
    emitMessagingEvent({ type: 'conversation:new', conversation }, audienceFor(cRows[0]));
    return { conversationId: String(id), created: true, conversation };
  }

  const rows = await query(
    `SELECT * FROM messages WHERE id IN (${createdIds.map(() => '?').join(',')}) ORDER BY created_at ASC, id ASC`,
    createdIds,
  );
  const messages = rows.map(rowToMessage);
  const conversation = await conversationPatch(id);
  // Bound chat → owner only; AI chat → everyone.
  const audience = conversation.handledBy === 'Live Agent' && conversation.assignedUserId != null
    ? [conversation.assignedUserId]
    : null;
  emitMessagingEvent({ type: 'message:new', conversationId: String(id), messages, conversation }, audience);
  return { conversationId: String(id), created: false, messages, conversation };
}
