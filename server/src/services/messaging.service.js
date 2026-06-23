import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { emitMessagingEvent } from './messaging.events.js';
import { moduleAccessForUser } from '../config/modules.js';
import { decrypt } from '../utils/crypto.util.js';
import * as tg from './telegram.service.js';
import * as fb from './fb.service.js';
import { searchAiMedia } from './vault.service.js';

// Conversation status set when the AI escalates a thread to a human (see
// handoffToLiveAgent). The inbound gateway stops auto-replying while a thread
// carries this status; taking the thread over clears it.
export const HANDOFF_STATUS = 'Needs human';

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
    deliveryStatus: row.delivery_status || undefined, // 'failed' surfaces in the UI
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

// Tell the open inbox(es) that some messages' delivery_status changed, so a failed
// send surfaces without a refresh. Same audience scoping as the messages themselves.
function broadcastStatus(conv, updates) {
  if (!updates.length) return;
  emitMessagingEvent({ type: 'message:status', conversationId: String(conv.id), updates }, audienceFor(conv));
}

// Push an outgoing (agent) reply to the customer on their origin platform and
// record whether it landed. Only Telegram is wired today; other origins leave
// delivery_status NULL (not applicable). Self-contained and best-effort — every
// failure resolves (logged + marked 'failed'), nothing throws. AI replies are
// delivered by n8n's own Telegram node, so this path is Live Agent → customer only.
//   items: [{ id, body, media }] aligned with the rows just inserted (media bubble
//   first, then text). replyToExternalId threads the FIRST bubble onto a prior
//   platform message, when we know its id.
// Platform dispatcher: deliver an outgoing message to the customer on the
// conversation's origin platform, using that page's stored credential. Telegram is
// wired; Messenger/WhatsApp adapters drop in here. No-op for unknown origins.
async function deliverToCustomer(conv, items = [], replyToExternalId = null) {
  const origin = String(conv?.origin || '').toLowerCase();
  if (origin.includes('telegram')) return deliverViaTelegram(conv, items, replyToExternalId);
  if (origin.includes('messenger') || origin.includes('facebook')) return deliverViaMessenger(conv, items);
  return undefined;
}

// Messenger Send API delivery (Graph) — media then text, using the page access
// token; recipient is the conversation's customer_handle (the customer PSID).
// Plain-text channels (Messenger) can't render Markdown, so flatten the little our
// agents emit: **bold** -> bold, `code` -> code, "- " bullets -> "• ".
function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/^[ \t]*[-*]\s+/gm, '• ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`\n]+?)`/g, '$1');
}

async function deliverViaMessenger(conv, items = []) {
  const psid = conv?.customer_handle;
  let token = '';
  try {
    if (conv.account_id != null) {
      const rows = await query('SELECT access_token FROM platform_accounts WHERE id = ?', [conv.account_id]);
      token = rows.length && rows[0].access_token ? decrypt(rows[0].access_token) : '';
    }
  } catch {
    token = '';
  }

  const updates = [];
  const mark = async (id, status, externalId) => {
    await query('UPDATE messages SET delivery_status = ?, external_id = COALESCE(?, external_id) WHERE id = ?', [
      status,
      externalId ?? null,
      id,
    ]).catch(() => {});
    updates.push({ id: String(id), deliveryStatus: status });
  };

  if (!psid || !token) {
    for (const it of items) await mark(it.id, 'failed');
    broadcastStatus(conv, updates);
    return;
  }

  for (const it of items) {
    let ok = false;
    let extId = null;
    let lastErr = '';
    if (it.media && it.media.length) {
      for (const m of it.media) {
        const r = await fb.sendMedia(token, psid, { url: m.url, type: m.type });
        if (r.ok) {
          ok = true;
          if (extId == null) extId = r.messageId;
        } else {
          lastErr = r.error;
        }
      }
      // Messenger has no native photo caption — a captioned bubble's text (in `body`)
      // follows the media as its own message (best-effort).
      if (it.body) await fb.sendMessage(token, psid, stripMarkdown(it.body)).catch(() => {});
    } else if (it.body) {
      const r = await fb.sendMessage(token, psid, stripMarkdown(it.body));
      ok = r.ok;
      extId = r.messageId;
      if (!r.ok) lastErr = r.error;
    } else {
      continue;
    }
    if (!ok) console.warn(`[messaging] Messenger delivery failed (conv ${conv.id}, msg ${it.id}): ${lastErr}`);
    await mark(it.id, ok ? 'sent' : 'failed', extId);
  }
  broadcastStatus(conv, updates);
}

async function deliverViaTelegram(conv, items = [], replyToExternalId = null) {
  if (!conv || !String(conv.origin || '').toLowerCase().includes('telegram')) return;
  const chatId = conv.customer_handle;

  let token = '';
  try {
    if (conv.account_id != null) {
      const rows = await query('SELECT telegram_bot_token FROM platform_accounts WHERE id = ?', [conv.account_id]);
      token = rows.length && rows[0].telegram_bot_token ? decrypt(rows[0].telegram_bot_token) : '';
    }
    if (!token) {
      // Thread not yet bound to its page (pre-binding) — fall back to the sole bot.
      const bots = await query('SELECT telegram_bot_token FROM platform_accounts WHERE telegram_bot_token IS NOT NULL');
      if (bots.length === 1 && bots[0].telegram_bot_token) token = decrypt(bots[0].telegram_bot_token);
    }
  } catch {
    token = '';
  }

  const updates = [];
  // Persist the outcome on the row and remember it for the SSE broadcast. We only
  // overwrite external_id when Telegram handed us a new message id.
  const mark = async (id, status, externalId) => {
    await query('UPDATE messages SET delivery_status = ?, external_id = COALESCE(?, external_id) WHERE id = ?', [
      status,
      externalId ?? null,
      id,
    ]).catch(() => {});
    updates.push({ id: String(id), deliveryStatus: status });
  };

  // Nothing can go out (no chat id / no bot) → mark them failed so the agent sees it.
  if (!chatId || !token) {
    for (const it of items) await mark(it.id, 'failed');
    broadcastStatus(conv, updates);
    return;
  }

  // Media first, then text — mirrors the stored bubble order. Only the first bubble
  // carries the reply thread; storing Telegram's returned id lets future replies
  // thread onto ours too.
  let replyId = replyToExternalId;
  for (const it of items) {
    let ok = false;
    let extId = null;
    let lastErr = '';
    if (it.media && it.media.length) {
      for (let k = 0; k < it.media.length; k += 1) {
        const m = it.media[k];
        // A captioned bubble (single image + text) carries its caption in `body` — ride
        // it on the first photo so the customer gets one photo-with-caption message.
        const r = await tg.sendMedia(token, chatId, { url: m.url, type: m.type, caption: k === 0 ? it.body : null, replyToMessageId: k === 0 ? replyId : null });
        if (r.ok) {
          ok = true;
          if (extId == null) extId = r.messageId;
        } else {
          lastErr = r.error;
        }
      }
    } else if (it.body) {
      const r = await tg.sendMessage(token, chatId, it.body, { replyToMessageId: replyId });
      ok = r.ok;
      extId = r.messageId;
      if (!r.ok) lastErr = r.error;
    } else {
      continue;
    }
    replyId = null;
    if (!ok) console.warn(`[messaging] Telegram delivery failed (conv ${conv.id}, msg ${it.id}): ${lastErr}`);
    await mark(it.id, ok ? 'sent' : 'failed', extId);
  }
  broadcastStatus(conv, updates);
}

// Send a reply. Messenger-style: media goes out as its own bubble first, then the
// text as a separate bubble; the reply reference (if any) rides the first bubble.
export async function sendMessage(id, actor = {}, { text, media, replyTo } = {}) {
  const exists = await query(
    'SELECT id, handled_by, assigned_user_id, account_id, customer_handle, origin FROM conversations WHERE id = ?',
    [id],
  );
  if (!exists.length) throw ApiError.notFound('conversation not found');
  assertCanAccess(exists[0], actor); // only the bound agent may reply

  const cleanText = typeof text === 'string' ? text.trim() : '';
  const mediaList = Array.isArray(media)
    ? media.filter((m) => m && m.url).map((m) => ({ type: m.type || 'file', url: String(m.url), name: m.name || '' }))
    : [];
  if (!cleanText && !mediaList.length) throw ApiError.badRequest('a message body or media is required');

  const reply =
    replyTo && replyTo.id ? { id: String(replyTo.id), sender: replyTo.sender || '', text: replyTo.text || '' } : null;

  // Caption a single image with the accompanying text (one photo-with-caption message)
  // instead of a separate photo bubble + text bubble — e.g. a dropped product card.
  const captionSingleImage = !!cleanText && mediaList.length === 1 && mediaList[0].type === 'image';

  const parts = [];
  if (mediaList.length) parts.push({ body: captionSingleImage ? cleanText : null, media: mediaList });
  if (cleanText && !captionSingleImage) parts.push({ body: cleanText, media: null });

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

  // Deliver to the customer on their platform, threading onto the quoted message
  // when we know its platform id. Fire-and-forget: the reply is already saved +
  // broadcast; the delivery outcome lands later via a message:status event.
  let replyToExternalId = null;
  if (reply) {
    const rr = await query('SELECT external_id FROM messages WHERE id = ?', [reply.id]).catch(() => []);
    replyToExternalId = rr.length ? rr[0].external_id : null;
  }
  const outgoingItems = parts.map((p, i) => ({ id: createdIds[i], body: p.body, media: p.media }));
  deliverToCustomer(exists[0], outgoingItems, replyToExternalId).catch((err) =>
    console.warn(`[messaging] reply delivery error (conv ${id}): ${err?.message || err}`),
  );

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
  // Clear any "Needs human" handoff flag — a human is now handling it.
  await query(
    "UPDATE conversations SET handled_by = 'Live Agent', assigned_user_id = ?, assigned_user_name = ?, status = NULL WHERE id = ?",
    [actor.id ?? null, actor.name ?? null, id],
  );
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(id), assignedUserId: Number(actor.id) });
  return conversationPatch(id);
}

// Hand a Live Agent thread BACK to the AI agent — the inverse of takeOver. Gated by
// the ALLOW_TRANSFER_TO_AI feature flag (controlled testing). Only the bound owner may
// release it. Clears assignment + any handoff status so the inbound gateway resumes
// forwarding the customer's messages to n8n. Broadcasts a reassignment so every inbox
// re-fetches (the thread is shared/unbound again).
export async function returnToAi(id, actor = {}) {
  if (!env.allowTransferToAi) {
    throw new ApiError(403, 'Handing a conversation back to the AI agent is disabled (ALLOW_TRANSFER_TO_AI is off).');
  }
  const rows = await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  assertCanAccess(rows[0], actor); // only the agent who owns it may release it

  await query(
    "UPDATE conversations SET handled_by = 'AI Agent', assigned_user_id = NULL, assigned_user_name = NULL, status = NULL WHERE id = ?",
    [id],
  );
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(id), assignedUserId: null });
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
//
// Telegram has no page id of its own, but a bot is always attached to a Facebook
// page (see platform_accounts), so we bind the chat to that page — that's what
// makes a Telegram thread appear under the page's filter. Resolution prefers an
// explicit bot @username; failing that, if exactly one page has a bot, we use it.
async function resolveAccount({ accountId, fbPageId, telegramBotUsername, origin } = {}) {
  if (accountId != null && accountId !== '') {
    const rows = await query('SELECT id, account_name FROM platform_accounts WHERE id = ?', [accountId]);
    if (rows.length) return rows[0];
  }
  if (fbPageId) {
    const rows = await query('SELECT id, account_name FROM platform_accounts WHERE fb_page_id = ? LIMIT 1', [fbPageId]);
    if (rows.length) return rows[0];
  }
  const fromTelegram = String(origin || '').toLowerCase().includes('telegram') || !!telegramBotUsername;
  if (fromTelegram) {
    const handle = String(telegramBotUsername || '').replace(/^@/, '').trim();
    if (handle) {
      const rows = await query(
        'SELECT id, account_name FROM platform_accounts WHERE telegram_bot_username = ? LIMIT 1',
        [handle],
      );
      if (rows.length) return rows[0];
    }
    const bots = await query('SELECT id, account_name FROM platform_accounts WHERE telegram_bot_token IS NOT NULL');
    if (bots.length === 1) return bots[0];
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
  const account = await resolveAccount({
    accountId: payload.accountId ?? payload.pageId,
    fbPageId: payload.fbPageId,
    telegramBotUsername: payload.telegramBotUsername ?? payload.botUsername,
    origin: payload.origin,
  });
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
      'INSERT INTO messages (conversation_id, side, sender, body, media, reply_to, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        side,
        sender,
        parts[i].body,
        parts[i].media ? JSON.stringify(parts[i].media) : null,
        i === 0 && reply ? JSON.stringify(reply) : null,
        payload.externalId != null && payload.externalId !== '' ? String(payload.externalId) : null,
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

  // Deliver an outgoing message (e.g. an AI reply posted here by n8n) to the customer
  // on their platform — but only while the thread is still AI-handled, so the AI
  // doesn't talk over a human who took over mid-generation. Live Agent replies are
  // delivered by sendMessage instead.
  if (side === 'outgoing') {
    const dRows = await query(
      'SELECT id, origin, customer_handle, account_id, handled_by, assigned_user_id FROM conversations WHERE id = ?',
      [id],
    );
    if (dRows.length && dRows[0].handled_by === 'AI Agent') {
      let replyExtId = null;
      if (reply) {
        const rr = await query('SELECT external_id FROM messages WHERE id = ?', [reply.id]).catch(() => []);
        replyExtId = rr.length ? rr[0].external_id : null;
      }
      const outItems = parts.map((p, i) => ({ id: createdIds[i], body: p.body, media: p.media }));
      deliverToCustomer(dRows[0], outItems, replyExtId).catch((e) =>
        console.warn(`[messaging] AI reply delivery error (conv ${id}): ${e?.message || e}`),
      );
    }
  }

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

// Escalate a thread to a human. Machine-authed (service token) — n8n calls this when
// the AI decides to hand off. It does NOT change ownership: the thread stays an
// (unbound) AI Agent chat so it remains claimable from any agent's inbox via takeOver,
// and so the AI's own handoff reply (sent right after, via /inbound) still delivers.
// Setting HANDOFF_STATUS is what makes the inbound gateway stop forwarding the
// customer's future messages to n8n. Idempotent; a no-op if a human already owns it.
export async function handoffToLiveAgent({ accountId, customerHandle, origin, reason } = {}) {
  const handle = String(customerHandle ?? '').trim();
  if (!handle) throw ApiError.badRequest('customerHandle is required');

  const account = await resolveAccount({ accountId, origin });
  const acctId = account?.id ?? null;
  const rows =
    acctId != null
      ? await query(
          'SELECT id, handled_by, assigned_user_id FROM conversations WHERE account_id = ? AND customer_handle = ? ORDER BY id DESC LIMIT 1',
          [acctId, handle],
        )
      : await query(
          'SELECT id, handled_by, assigned_user_id FROM conversations WHERE account_id IS NULL AND customer_handle = ? ORDER BY id DESC LIMIT 1',
          [handle],
        );
  if (!rows.length) throw ApiError.notFound('no conversation found for this customer');

  const conv = rows[0];
  // A human already has it — leave their ownership untouched.
  if (conv.handled_by === 'Live Agent') {
    return { conversationId: String(conv.id), handedOff: false, alreadyLive: true };
  }

  await query('UPDATE conversations SET status = ?, last_message_at = NOW() WHERE id = ?', [HANDOFF_STATUS, conv.id]);
  const conversation = await conversationPatch(conv.id);
  // Unbound AI thread → broadcast to everyone so any agent can pick it up.
  emitMessagingEvent({ type: 'conversation:updated', conversation, handoffReason: reason || null }, null);
  return { conversationId: String(conv.id), handedOff: true, conversation };
}

// Product lookup the AI agent's `search_catalog` tool calls — MySQL FULLTEXT over
// the page's catalog (products only; FAQs are answered from the Supabase vector
// store instead). SCOPED to one page via account_id (the conversation's page,
// passed by the tool — never the LLM), so a page's agent only ever sees its own
// products. `LIMIT` is inlined from a sanitized integer (mysql2 won't bind LIMIT as
// a param). Guarded so a missing index (pre-migration) degrades to [] not an error.
export async function searchKnowledge(rawQuery, { accountId, limit = 6 } = {}) {
  const q = String(rawQuery ?? '').trim();
  const acct = parseInt(accountId, 10);
  // No page → no results (never fall back to a cross-page / global search).
  if (!q || !Number.isInteger(acct)) return { products: [] };
  const lim = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20);

  const products = await query(
    `SELECT id, name, category, price,
            MATCH(name, category, description) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
       FROM products
      WHERE account_id = ?
        AND MATCH(name, category, description) AGAINST (? IN NATURAL LANGUAGE MODE)
      ORDER BY score DESC, id ASC
      LIMIT ${lim}`,
    [q, acct, q],
  ).catch(() => []);

  return { products: products.map((p) => ({ id: p.id, name: p.name, category: p.category, price: p.price })) };
}

// The AI agent's `send_media` tool: find a media file in THIS page's Vault folder
// matching the query and deliver it to the customer (same outgoing path as any
// media — Telegram/Messenger sendMedia + inbox bubble + SSE). Scoped to the page's
// folder and skips ai_hidden files; accountId/customerHandle come from the
// conversation (the tool), never the LLM. Returns a short status the agent speaks to.
export async function sendVaultMedia({ accountId, customerHandle, origin, query: rawQuery } = {}) {
  const acct = parseInt(accountId, 10);
  const handle = String(customerHandle ?? '').trim();
  const q = String(rawQuery ?? '').trim();
  if (!Number.isInteger(acct) || !handle || !q) {
    return { sent: false, reason: 'accountId, customerHandle, and query are required' };
  }

  const rows = await query('SELECT vault_folder_id FROM platform_accounts WHERE id = ?', [acct]);
  const folderId = rows.length ? rows[0].vault_folder_id : null;
  if (folderId == null) return { sent: false, reason: "this page has no media folder yet" };

  const matches = await searchAiMedia(folderId, q, { limit: 4 });
  if (!matches.length) return { sent: false, reason: "no matching file found in this page's folder" };

  const top = matches[0];
  // side:'outgoing' + AI-handled → receiveInbound delivers it to the customer and
  // records the bubble. (It won't send if a human has taken the thread over.)
  await receiveInbound({
    accountId: acct,
    customerHandle: handle,
    origin,
    side: 'outgoing',
    media: [{ type: top.mediaType, url: top.url, name: top.name }],
  });

  // Hand the agent the sent file's description/tags (so it can tell the customer
  // what it sent) plus the same for the runners-up (so it can offer them).
  return {
    sent: true,
    file: top.name,
    description: top.description || '',
    tags: top.tags || [],
    alternatives: matches.slice(1).map((m) => ({
      name: m.name,
      description: m.description || '',
      tags: m.tags || [],
    })),
  };
}
