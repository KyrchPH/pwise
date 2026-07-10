import { query, getConnection } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { emitMessagingEvent } from './messaging.events.js';
import { canUseModule } from '../config/modules.js';
import { decrypt } from '../utils/crypto.util.js';
import * as tg from './telegram.service.js';
import * as fb from './fb.service.js';
import * as wa from './whatsapp.service.js';
import { searchAiMedia, searchAiMediaMeta } from './vault.service.js';
import * as conversationNotes from './conversation_notes.service.js';
import * as presence from './messaging.presence.js';
import { formatBusinessProfile, parseBusinessProfile } from '../utils/business_profile.util.js';
import * as geoapify from './geoapify.service.js';

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
  return canUseModule(user, 'messages');
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

function rowToConversation(c, messageRows, pending = null) {
  return {
    id: String(c.id),
    createdAt: c.created_at || null,
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
    // A pending outgoing transfer locks the owner's composer until it's accepted
    // (then the thread leaves their view) or declined (then it unlocks).
    transferPending: !!pending,
    transferPendingTo: pending?.toName || '',
    // Blocked customer — inbound is dropped (gateway) and n8n isn't forwarded.
    blocked: !!c.blocked,
    blockedBy: c.blocked_by_name || '',
    blockedAt: c.blocked_at || null,
    messages: messageRows.map(rowToMessage),
  };
}

// Lightweight mutable fields the client merges after an action / SSE event.
async function conversationPatch(id) {
  const rows = await query(
    'SELECT id, created_at, summary, unread, customer_name, customer_avatar, handled_by, assigned_user_id, assigned_user_name, status, last_message_at, blocked, blocked_by_name, blocked_at FROM conversations WHERE id = ?',
    [id],
  );
  if (!rows.length) return null;
  const c = rows[0];
  return {
    id: String(c.id),
    createdAt: c.created_at || null,
    summary: c.summary || '',
    unread: Number(c.unread) || 0,
    customerName: c.customer_name || '',
    avatarUrl: c.customer_avatar || '',
    handledBy: c.handled_by,
    assignedUserId: c.assigned_user_id != null ? Number(c.assigned_user_id) : null,
    assignedUserName: c.assigned_user_name || '',
    status: c.status || '',
    lastActivity: humanizeSince(c.last_message_at),
    blocked: !!c.blocked,
    blockedBy: c.blocked_by_name || '',
    blockedAt: c.blocked_at || null,
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
  // Pending outgoing transfers for these threads, so the owner's composer shows as
  // locked on load (not only live via SSE).
  const pendingByConv = new Map();
  const ptRows = await query(
    `SELECT conversation_id, to_user_name FROM conversation_transfers
      WHERE status = 'pending' AND conversation_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  for (const r of ptRows) pendingByConv.set(r.conversation_id, { toName: r.to_user_name || '' });
  return convs.map((c) => rowToConversation(c, byConv.get(c.id) || [], pendingByConv.get(c.id) || null));
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
  const ptRows = await query(
    "SELECT to_user_name FROM conversation_transfers WHERE conversation_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    [id],
  );
  const pending = ptRows.length ? { toName: ptRows[0].to_user_name || '' } : null;
  return rowToConversation(rows[0], msgs, pending);
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
// conversation's origin platform, using that page's stored credential. No-op for unknown
// origins. Instagram is the Messenger Platform (same Send API + page token), so it shares
// deliverViaMeta; WhatsApp has its own Cloud-API adapter.
async function deliverToCustomer(conv, items = [], replyToExternalId = null) {
  const origin = String(conv?.origin || '').toLowerCase();
  if (origin.includes('telegram')) return deliverViaTelegram(conv, items, replyToExternalId);
  if (origin.includes('instagram') || origin.includes('messenger') || origin.includes('facebook')) return deliverViaMeta(conv, items);
  if (origin.includes('whatsapp')) return deliverViaWhatsapp(conv, items);
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

// Messenger + Instagram delivery — identical Send API (me/messages) + page access token;
// recipient is the conversation's customer_handle (PSID for Messenger, IGSID for IG).
async function deliverViaMeta(conv, items = []) {
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

// WhatsApp Cloud API delivery — media then text, using the page's WhatsApp token +
// phone number id; recipient is the conversation's customer_handle (the customer's
// number). v1 sends free-form (valid inside the 24h customer-care window).
async function deliverViaWhatsapp(conv, items = []) {
  const to = conv?.customer_handle;
  let token = '';
  let phoneNumberId = '';
  try {
    if (conv.account_id != null) {
      const rows = await query('SELECT wa_access_token, wa_phone_number_id FROM platform_accounts WHERE id = ?', [conv.account_id]);
      if (rows.length) {
        token = rows[0].wa_access_token ? decrypt(rows[0].wa_access_token) : '';
        phoneNumberId = rows[0].wa_phone_number_id || '';
      }
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

  if (!to || !token || !phoneNumberId) {
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
        const r = await wa.sendMedia(token, phoneNumberId, to, { url: m.url, type: m.type });
        if (r.ok) {
          ok = true;
          if (extId == null) extId = r.messageId;
        } else {
          lastErr = r.error;
        }
      }
      // Send the caption as its own message to mirror the stored bubble order.
      if (it.body) await wa.sendText(token, phoneNumberId, to, stripMarkdown(it.body)).catch(() => {});
    } else if (it.body) {
      const r = await wa.sendText(token, phoneNumberId, to, stripMarkdown(it.body));
      ok = r.ok;
      extId = r.messageId;
      if (!r.ok) lastErr = r.error;
    } else {
      continue;
    }
    if (!ok) console.warn(`[messaging] WhatsApp delivery failed (conv ${conv.id}, msg ${it.id}): ${lastErr}`);
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
      // 2+ photos/videos go out as ONE Telegram album (gallery) instead of a message
      // each; the caption rides the first item. A single item, or a bubble mixing in a
      // non-media file, uses the per-file path. If the album call fails, fall back to
      // one-by-one so the photos still reach the customer.
      const albumable = it.media.length >= 2 && it.media.every((m) => /^(image|video)/i.test(String(m.type || '')));
      let albumSent = false;
      if (albumable) {
        const r = await tg.sendMediaGroup(token, chatId, it.media, { caption: it.body, replyToMessageId: replyId });
        if (r.ok) {
          ok = true;
          albumSent = true;
          extId = r.messageId;
        } else {
          lastErr = r.error; // fall through to per-file
        }
      }
      if (!albumSent) {
        for (let k = 0; k < it.media.length; k += 1) {
          const m = it.media[k];
          // A captioned bubble (single image + text) carries its caption in `body` —
          // ride it on the first photo so the customer gets one photo-with-caption message.
          const r = await tg.sendMedia(token, chatId, { url: m.url, type: m.type, caption: k === 0 ? it.body : null, replyToMessageId: k === 0 ? replyId : null });
          if (r.ok) {
            ok = true;
            if (extId == null) extId = r.messageId;
          } else {
            lastErr = r.error;
          }
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
  // Taking over settles ownership directly — any in-flight transfer is moot, so clear it
  // (otherwise a stale pending transfer would lock the new owner's composer).
  await clearPendingTransfers(id);
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(id), assignedUserId: Number(actor.id) });
  return { ...(await conversationPatch(id)), transferPending: false, transferPendingTo: '' };
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
  // Handing back to the AI voids any pending transfer on the thread.
  await clearPendingTransfers(id);
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(id), assignedUserId: null });
  return { ...(await conversationPatch(id)), transferPending: false, transferPendingTo: '' };
}

// ── Block / unblock a customer ───────────────────────────────────────────────
// A blocked thread drops the customer's inbound — the gateway never records it or
// forwards it to n8n (see isCustomerBlocked). Both a Live Agent and the AI can block;
// only a Live Agent (a human; there is NO service-token unblock route) can unblock,
// including threads still assigned to the AI Agent.

async function setBlocked(id, blocked, byId, byName) {
  await query(
    'UPDATE conversations SET blocked = ?, blocked_at = ?, blocked_by = ?, blocked_by_name = ? WHERE id = ?',
    [blocked ? 1 : 0, blocked ? new Date() : null, blocked ? byId : null, blocked ? byName : null, id],
  );
}

// Is this (account, customer) currently blocked? The inbound gateway calls this before
// recording / forwarding a message. Fails OPEN (returns false) so a lookup hiccup can't
// silently drop real messages.
export async function isCustomerBlocked({ accountId, customerHandle } = {}) {
  const handle = String(customerHandle ?? '').trim();
  if (!handle) return false;
  try {
    const acct = accountId != null && accountId !== '' ? Number(accountId) : null;
    const rows =
      acct != null
        ? await query('SELECT blocked FROM conversations WHERE account_id = ? AND customer_handle = ? ORDER BY id DESC LIMIT 1', [acct, handle])
        : await query('SELECT blocked FROM conversations WHERE account_id IS NULL AND customer_handle = ? ORDER BY id DESC LIMIT 1', [handle]);
    return rows.length ? !!rows[0].blocked : false;
  } catch {
    return false;
  }
}

// Live Agent blocks the customer from the inbox (thread must be one they can access).
export async function blockConversation(id, actor = {}) {
  const rows = await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  assertCanAccess(rows[0], actor);
  await setBlocked(id, true, actor.id ?? null, actor.name || 'Live Agent');
  const conversation = await conversationPatch(id);
  emitMessagingEvent({ type: 'conversation:updated', conversation }, audienceFor(rows[0]));
  return conversation;
}

// Unblock — a human Live Agent only (no service-token route), allowed even when the
// thread is still assigned to the AI Agent.
export async function unblockConversation(id, actor = {}) {
  const rows = await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('conversation not found');
  assertCanAccess(rows[0], actor);
  await setBlocked(id, false, null, null);
  const conversation = await conversationPatch(id);
  emitMessagingEvent({ type: 'conversation:updated', conversation }, audienceFor(rows[0]));
  return conversation;
}

// AI Agent (service token) blocks a customer by handle — its `block_customer` tool.
export async function blockByCustomer({ accountId, customerHandle, origin } = {}) {
  const handle = String(customerHandle ?? '').trim();
  if (!handle) throw ApiError.badRequest('customerHandle is required');
  const account = await resolveAccount({ accountId, origin });
  const acct = account?.id ?? null;
  const rows =
    acct != null
      ? await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE account_id = ? AND customer_handle = ? ORDER BY id DESC LIMIT 1', [acct, handle])
      : await query('SELECT id, handled_by, assigned_user_id FROM conversations WHERE account_id IS NULL AND customer_handle = ? ORDER BY id DESC LIMIT 1', [handle]);
  if (!rows.length) throw ApiError.notFound('no conversation found for this customer');
  await setBlocked(rows[0].id, true, null, 'AI Agent');
  const conversation = await conversationPatch(rows[0].id);
  emitMessagingEvent({ type: 'conversation:updated', conversation }, audienceFor(rows[0]));
  return { conversationId: String(rows[0].id), blocked: true };
}

// ── Transfers (hand a conversation to another agent, who must accept) ─────────

// All active users with Messaging access (id, name, email). The pool the AI hands a
// thread off to (handoffToLiveAgent) and the basis for the transfer picker below.
async function eligibleMessagingAgents() {
  const rows = await query(
    'SELECT id, name, email, role, module_access FROM users WHERE is_active = 1 AND deleted_at IS NULL ORDER BY name ASC, email ASC',
  );
  return rows
    .filter((u) => hasMessagingAccess(u))
    .map((u) => ({ id: Number(u.id), name: u.name || u.email, email: u.email }));
}

// Teammates a conversation can be transferred to: the eligible pool minus the
// requester. Used by the transfer picker.
export async function listAgents(actor = {}) {
  return (await eligibleMessagingAgents()).filter((u) => u.id !== Number(actor.id));
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

  // Require a handoff note from THIS agent as the conversation's MOST RECENT note —
  // forces them to summarize before passing the chat on, so the recipient has context.
  const lastNote = await query(
    'SELECT created_by FROM conversation_notes WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [conversationId],
  );
  if (!lastNote.length || Number(lastNote[0].created_by) !== Number(actor.id)) {
    throw ApiError.badRequest('Add a note before transferring — your note must be the most recent one on this conversation.');
  }

  // One pending transfer per conversation — supersede any earlier pending one.
  await query("UPDATE conversation_transfers SET status = 'cancelled', responded_at = NOW() WHERE conversation_id = ? AND status = 'pending'", [conversationId]);
  const res = await query(
    "INSERT INTO conversation_transfers (conversation_id, from_user_id, from_user_name, to_user_id, to_user_name, status) VALUES (?, ?, ?, ?, ?, 'pending')",
    [conversationId, actor.id ?? null, actor.name ?? null, target, tRows[0].name ?? null],
  );
  const transfer = transferToClient(await loadTransfer(res.insertId));
  emitMessagingEvent({ type: 'transfer:new', transfer }, [target]); // only the recipient is notified
  // Lock the sender's composer immediately — their thread now has a pending transfer.
  emitMessagingEvent(
    { type: 'conversation:updated', conversation: { id: String(conversationId), transferPending: true, transferPendingTo: tRows[0].name || '' } },
    [Number(actor.id)].filter(Boolean),
  );
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
  // Unlock the sender's composer — the transfer was declined, the thread is theirs again.
  emitMessagingEvent(
    { type: 'conversation:updated', conversation: { id: String(t.conversation_id), transferPending: false, transferPendingTo: '' } },
    [Number(t.from_user_id)].filter(Boolean),
  );
  return { id: Number(transferId), declined: true };
}

// Cancel every pending transfer on a conversation — used when ownership is settled
// another way (takeOver / returnToAi), so a stale pending transfer can't keep a thread's
// composer locked. Notifies both parties so their incoming-request badge + composer lock
// clear. No-op when nothing is pending.
async function clearPendingTransfers(conversationId) {
  const rows = await query(
    "SELECT id, from_user_id, to_user_id FROM conversation_transfers WHERE conversation_id = ? AND status = 'pending'",
    [conversationId],
  );
  if (!rows.length) return;
  await query(
    "UPDATE conversation_transfers SET status = 'cancelled', responded_at = NOW() WHERE conversation_id = ? AND status = 'pending'",
    [conversationId],
  );
  for (const t of rows) {
    emitMessagingEvent(
      { type: 'transfer:resolved', transferId: Number(t.id) },
      [Number(t.to_user_id), Number(t.from_user_id)].filter(Boolean),
    );
    if (t.from_user_id) {
      emitMessagingEvent(
        { type: 'conversation:updated', conversation: { id: String(conversationId), transferPending: false, transferPendingTo: '' } },
        [Number(t.from_user_id)],
      );
    }
  }
}

// Cancel the pending transfer on this conversation. The agent who requested it may
// cancel — and so may the agent who currently OWNS the thread (e.g. after taking it
// over), so a transfer started by someone else can't lock them out. Clears the
// recipient's incoming request (transfer:resolved) and unlocks the composer
// (conversation:updated). A no-op if nothing is pending, so a double-cancel or an
// accept/cancel race can't error.
export async function cancelTransfer(conversationId, actor = {}) {
  const rows = await query(
    "SELECT id, from_user_id, to_user_id FROM conversation_transfers WHERE conversation_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    [conversationId],
  );
  if (!rows.length) return { cancelled: false, conversationId: String(conversationId) };
  const t = rows[0];
  const convRows = await query('SELECT handled_by, assigned_user_id FROM conversations WHERE id = ?', [conversationId]);
  const isOwner = convRows.length && convRows[0].handled_by === 'Live Agent' && Number(convRows[0].assigned_user_id) === Number(actor.id);
  if (Number(t.from_user_id) !== Number(actor.id) && !isOwner) {
    throw new ApiError(403, 'Only the agent handling this conversation, or who started the transfer, can cancel it.');
  }
  await query("UPDATE conversation_transfers SET status = 'cancelled', responded_at = NOW() WHERE id = ?", [t.id]);
  // The recipient's incoming request disappears; both sides see it resolved.
  emitMessagingEvent({ type: 'transfer:resolved', transferId: Number(t.id) }, [Number(t.to_user_id), Number(t.from_user_id)].filter(Boolean));
  // Unlock the composer — for the original sender AND whoever cancelled (the owner).
  emitMessagingEvent(
    { type: 'conversation:updated', conversation: { id: String(conversationId), transferPending: false, transferPendingTo: '' } },
    [Number(t.from_user_id), Number(actor.id)].filter(Boolean),
  );
  return { cancelled: true, conversationId: String(conversationId) };
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
// `runner` lets a caller pass a transaction-bound query fn (conn.query wrapper) so the
// find/create runs inside the SAME transaction as the message insert; defaults to the
// plain pool query for callers that don't need atomicity.
async function resolveOrCreateConversation(payload, account, { createIfMissing = true, runner = query } = {}) {
  if (payload.conversationId != null && payload.conversationId !== '') {
    const rows = await runner('SELECT id FROM conversations WHERE id = ?', [payload.conversationId]);
    if (!rows.length) throw ApiError.notFound('conversation not found');
    return { id: Number(rows[0].id), created: false };
  }

  const accountId = account?.id ?? null;
  const handle = payload.customerHandle ? String(payload.customerHandle).trim() : '';

  // A customer is identified within a page by their handle — reuse that thread.
  if (handle) {
    const rows =
      accountId != null
        ? await runner(
            'SELECT id FROM conversations WHERE account_id = ? AND customer_handle = ? ORDER BY id DESC LIMIT 1',
            [accountId, handle],
          )
        : await runner(
            'SELECT id FROM conversations WHERE account_id IS NULL AND customer_handle = ? ORDER BY id DESC LIMIT 1',
            [handle],
          );
    if (rows.length) return { id: Number(rows[0].id), created: false };
  }

  // New thread — needs a display name (fall back to the handle).
  if (!createIfMissing) {
    throw ApiError.badRequest(
      handle
        ? 'outgoing AI reply target conversation was not found'
        : 'outgoing AI replies require conversationId or customerHandle',
    );
  }

  const customerName = String(payload.customerName || '').trim() || handle || 'New customer';
  const result = await runner(
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

  // Summary/unread for the thread row (computed up front; applied in the txn below).
  const summary = payload.summary || cleanText || `${mediaList.length} attachment${mediaList.length === 1 ? '' : 's'}`;
  let bump = side === 'incoming' ? 1 : 0;
  if (payload.incrementUnread === true) bump = 1;
  if (payload.incrementUnread === false) bump = 0;

  // Find-or-create the thread AND record its message(s) atomically. Without this, a
  // failed message INSERT (e.g. a too-long value) would leave a brand-new thread as an
  // empty orphan, because the conversation row is created first. One transaction →
  // either both land or neither does.
  const createdIds = [];
  let id;
  let created;
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const runner = async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    ({ id, created } = await resolveOrCreateConversation(payload, account, {
      // Outgoing normally can't create a thread (an AI reply must target an existing one).
      // A page-INITIATED outbound (e.g. a Messenger private reply to a commenter) opts in
      // with createIfMissing:true so it can open a brand-new conversation.
      createIfMissing: payload.createIfMissing ?? side !== 'outgoing',
      runner,
    }));

    for (let i = 0; i < parts.length; i += 1) {
      const [result] = await conn.query(
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

    // Refresh the thread's summary + activity time and bump unread. Incoming customer
    // messages mark the thread unread; AI replies don't, unless overridden.
    const sets = ['summary = ?', 'last_message_at = NOW()', 'unread = unread + ?'];
    const params = [summary, bump];
    // Refresh the customer's profile photo when the adapter supplies one — Meta CDN
    // URLs expire, so each inbound message carries a fresh link. Only overwrite on a
    // real value; a null/absent avatar leaves the existing one untouched.
    if (payload.customerAvatar) {
      sets.push('customer_avatar = ?');
      params.push(String(payload.customerAvatar));
    }
    // Heal the display name when the adapter resolved a REAL one (e.g. a thread first
    // created as "Messenger user" before the profile lookup worked). Guarded by
    // customerNameResolved so a failed lookup never clobbers a good name.
    if (payload.customerNameResolved) {
      sets.push('customer_name = ?');
      params.push(String(payload.customerNameResolved));
    }
    if (payload.status) {
      sets.push('status = ?');
      params.push(payload.status);
    }
    if (payload.handledBy === 'AI Agent' || payload.handledBy === 'Live Agent') {
      sets.push('handled_by = ?');
      params.push(payload.handledBy);
    }
    params.push(id);
    await conn.query(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, params);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // Deliver an outgoing message (e.g. an AI reply posted here by n8n) to the customer
  // on their platform — but only while the thread is still AI-handled, so the AI
  // doesn't talk over a human who took over mid-generation. Live Agent replies are
  // delivered by sendMessage instead. Callers that only RECORD an already-sent message
  // (e.g. a human's Messenger echo, sent from the Page inbox) pass deliver:false so we
  // don't bounce it back to the customer a second time.
  if (side === 'outgoing' && payload.deliver !== false) {
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
    // TEMP DIAGNOSTIC: _debug carries the inbound profile-resolution detail to the browser
    // console (see inbound_gateway). Remove once "Messenger user" is diagnosed.
    emitMessagingEvent({ type: 'conversation:new', conversation, _debug: payload.debug }, audienceFor(cRows[0]));
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
  emitMessagingEvent({ type: 'message:new', conversationId: String(id), messages, conversation, _debug: payload.debug }, audience);
  return { conversationId: String(id), created: false, messages, conversation };
}

// Escalate a thread to a human. Machine-authed (service token) — n8n calls this when
// the AI decides to hand off. Assigns the thread to a RANDOM available agent
// (handled_by = 'Live Agent'); that ownership change is itself what makes the inbound
// gateway stop forwarding the customer's future messages to the AI — no "Needs human"
// flag needed. The AI's own handoff reply (sent right after, via /inbound) still records
// on the thread. If no agent is available it falls back to flagging HANDOFF_STATUS
// (unbound) so the AI still pauses and the thread waits to be claimed. Idempotent; a
// no-op if a human already owns it.
// Fallback wording for the app-sent "a human is taking over" notice when a page hasn't
// set its own live_agent_transfer_message in Settings → Pages.
const DEFAULT_TRANSFER_MESSAGE =
  'Let me connect you with a live agent who can better assist you. 🙌 Please hold on — someone will be with you shortly.';

// The page's configured transfer notice (or the default). Best-effort.
async function transferNotice(acctId) {
  if (acctId == null) return DEFAULT_TRANSFER_MESSAGE;
  try {
    const rows = await query('SELECT live_agent_transfer_message FROM platform_accounts WHERE id = ?', [acctId]);
    const msg = String(rows[0]?.live_agent_transfer_message ?? '').trim();
    return msg || DEFAULT_TRANSFER_MESSAGE;
  } catch {
    return DEFAULT_TRANSFER_MESSAGE;
  }
}

export async function handoffToLiveAgent({ accountId, customerHandle, origin, reason, note } = {}) {
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

  // Tell the customer a human is taking over — deterministically, from the app (not the
  // LLM). Sent WHILE the thread is still AI-handled and BEFORE ownership flips, so it
  // delivers even in the online case (where a post-handoff AI message would be suppressed
  // by the "don't talk over a human" guard in receiveInbound). Best-effort — never blocks
  // the handoff itself.
  try {
    await receiveInbound({
      accountId: acctId,
      origin,
      side: 'outgoing',
      sender: 'AI Agent',
      text: await transferNotice(acctId),
      customerHandle: handle,
      incrementUnread: false,
    });
  } catch (e) {
    console.warn(`[messaging] transfer notice failed (conv ${conv.id}): ${e?.message || e}`);
  }

  // Every handoff leaves a note on the thread so whoever picks it up has context. The
  // AI passes a short summary; fall back to a generic line if it didn't. Best-effort —
  // a note failure must never block the handoff itself.
  const writeHandoffNote = async () => {
    const body = String(note ?? '').trim() || 'The AI transferred this conversation to a live agent.';
    try {
      await conversationNotes.create(conv.id, { id: null, name: 'AI Agent' }, { body });
    } catch (e) {
      console.warn(`[messaging] handoff note failed (conv ${conv.id}): ${e?.message || e}`);
    }
  };

  // No one to hand to → flag "Needs human" (unbound) so the AI pauses and any agent can
  // claim it later, rather than binding it to an owner who isn't there.
  const agents = await eligibleMessagingAgents();
  if (!agents.length) {
    await query('UPDATE conversations SET status = ?, last_message_at = NOW() WHERE id = ?', [HANDOFF_STATUS, conv.id]);
    await writeHandoffNote();
    const conversation = await conversationPatch(conv.id);
    emitMessagingEvent({ type: 'conversation:updated', conversation, handoffReason: reason || null }, null);
    return { conversationId: String(conv.id), handedOff: true, assignedUserId: null, conversation };
  }

  // Assign to a random available agent. Clearing status + setting handled_by = 'Live
  // Agent' is enough to stop the gateway forwarding the customer's next messages to n8n.
  const agent = agents[Math.floor(Math.random() * agents.length)];
  await query(
    "UPDATE conversations SET handled_by = 'Live Agent', assigned_user_id = ?, assigned_user_name = ?, status = NULL, last_message_at = NOW() WHERE id = ?",
    [agent.id, agent.name, conv.id],
  );
  await writeHandoffNote();
  const conversation = await conversationPatch(conv.id);
  // Same signal as a manual take-over: every inbox refetches, so the chosen agent gains
  // the thread and other agents drop it from their shared AI view.
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(conv.id), assignedUserId: agent.id }, null);
  return { conversationId: String(conv.id), handedOff: true, assignedUserId: agent.id, conversation };
}

// The AI agent's `create_order` tool (machine-authed; n8n calls it once an order is
// confirmed). Records the order details the AI gathered as a note, then routes:
//   • ≥1 ELIGIBLE AGENT ONLINE  → bind the thread to the online agent with the FEWEST
//     active (Live Agent) conversations, random tie-break — a teammate takes over right
//     away (binding pauses the AI, like any take-over). routed: 'transferred'.
//   • NO AGENT ONLINE           → drop it in the Pool (status 'Needs human', unassigned,
//     AI paused) so whoever comes online can claim it. routed: 'pooled'.
// "Online" is live inbox presence (messaging.presence). If a human already owns the
// thread we keep their ownership and just add the order note (routed: 'already_live').
// The returned `online`/`routed` tells the agent which closing message to send.
export async function createOrder({ accountId, customerHandle, origin, note } = {}) {
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

  // Always record what the AI gathered, so whoever processes the order has it.
  const body = String(note ?? '').trim() || 'Order request (the AI did not capture details).';
  try {
    await conversationNotes.create(conv.id, { id: null, name: 'AI Agent' }, { body });
  } catch (e) {
    console.warn(`[messaging] order note failed (conv ${conv.id}): ${e?.message || e}`);
  }

  // A human already owns it — leave their ownership, the note is enough.
  if (conv.handled_by === 'Live Agent') {
    const conversation = await conversationPatch(conv.id);
    return { conversationId: String(conv.id), routed: 'already_live', online: true, conversation };
  }

  // Eligible agents who are ONLINE right now (logged in + active tab; presence).
  const eligible = await eligibleMessagingAgents();
  const onlineIds = new Set(await presence.filterOnline(eligible.map((a) => a.id)));
  const agents = eligible.filter((a) => onlineIds.has(Number(a.id)));

  // No one online → Pool it (claimable, AI paused), tell the customer we'll follow up.
  if (!agents.length) {
    await query('UPDATE conversations SET status = ?, last_message_at = NOW() WHERE id = ?', [HANDOFF_STATUS, conv.id]);
    const conversation = await conversationPatch(conv.id);
    emitMessagingEvent({ type: 'conversation:updated', conversation }, null);
    return { conversationId: String(conv.id), routed: 'pooled', online: false, conversation };
  }

  // Pick the online agent carrying the fewest active conversations; tie → random.
  const ids = agents.map((a) => Number(a.id));
  const loadRows = await query(
    `SELECT assigned_user_id AS uid, COUNT(*) AS c
       FROM conversations
      WHERE handled_by = 'Live Agent' AND assigned_user_id IN (${ids.map(() => '?').join(',')})
      GROUP BY assigned_user_id`,
    ids,
  );
  const loadByUser = new Map(loadRows.map((r) => [Number(r.uid), Number(r.c)]));
  const loadOf = (a) => loadByUser.get(Number(a.id)) || 0;
  const minLoad = Math.min(...agents.map(loadOf));
  const leastBusy = agents.filter((a) => loadOf(a) === minLoad);
  const agent = leastBusy[Math.floor(Math.random() * leastBusy.length)];

  await query(
    "UPDATE conversations SET handled_by = 'Live Agent', assigned_user_id = ?, assigned_user_name = ?, status = NULL, last_message_at = NOW() WHERE id = ?",
    [agent.id, agent.name, conv.id],
  );
  const conversation = await conversationPatch(conv.id);
  emitMessagingEvent({ type: 'conversation:reassigned', conversationId: String(conv.id), assignedUserId: agent.id }, null);
  return {
    conversationId: String(conv.id),
    routed: 'transferred',
    online: true,
    assignedUserId: agent.id,
    assignedUserName: agent.name,
    conversation,
  };
}

// Product lookup the AI agent's `search_catalog` tool calls — MySQL FULLTEXT over
// the page's catalog (products only; FAQs are answered from the Supabase vector
// store instead). SCOPED to one page via account_id (the conversation's page,
// passed by the tool — never the LLM), so a page's agent only ever sees its own
// products. `LIMIT` is inlined from a sanitized integer (mysql2 won't bind LIMIT as
// a param). Guarded so a missing index (pre-migration) degrades to [] not an error.
export async function searchKnowledge(rawQuery, { accountId, limit = 50 } = {}) {
  const q = String(rawQuery ?? '').trim();
  const acct = parseInt(accountId, 10);
  // No page → no results (never fall back to a cross-page / global search).
  if (!Number.isInteger(acct)) return { products: [], media: [] };
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const cleanName = (n) => String(n || '').replace(/\.[a-z0-9]+$/i, '').trim();

  // SOURCE 1 — the products table (structured: name / category / price). Empty query →
  // the FULL catalog cheapest-first (for "what's your cheapest?" / "list everything");
  // otherwise a FULLTEXT keyword match. The higher limit keeps broad queries complete.
  let productRows;
  if (!q) {
    productRows = await query(
      `SELECT id, name, category, price FROM products
        WHERE account_id = ?
        ORDER BY (price IS NULL), price ASC, name ASC
        LIMIT ${lim}`,
      [acct],
    ).catch(() => []);
  } else {
    productRows = await query(
      `SELECT id, name, category, price,
              MATCH(name, category, description) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
         FROM products
        WHERE account_id = ?
          AND MATCH(name, category, description) AGAINST (? IN NATURAL LANGUAGE MODE)
        ORDER BY score DESC, (price IS NULL), price ASC, id ASC
        LIMIT ${lim}`,
      [q, acct, q],
    ).catch(() => []);
  }
  const products = productRows.map((p) => ({ id: p.id, name: p.name, category: p.category, price: p.price }));

  // SOURCE 2 — the page's Vault media descriptions/tags. A second source so items that
  // only live as a tagged image (details + price in the caption) are still found.
  // De-duped against products by name so shared items aren't listed twice.
  let media = [];
  try {
    const rows = await query('SELECT vault_folder_id FROM platform_accounts WHERE id = ?', [acct]);
    const folderId = rows.length ? rows[0].vault_folder_id : null;
    if (folderId != null) {
      const seen = new Set(products.map((p) => cleanName(p.name).toLowerCase()));
      const metas = await searchAiMediaMeta(folderId, q, { limit: lim });
      media = metas
        .filter((m) => !seen.has(cleanName(m.name).toLowerCase()))
        .map((m) => ({ name: cleanName(m.name), price: m.price ?? null, description: m.description, tags: m.tags }));
    }
  } catch {
    media = [];
  }

  return { products, media };
}

// The AI agent's `get_page_info` tool: the page's admin-filled Business profile —
// address / location, phone, Viber/WhatsApp, email, operating hours, website. SCOPED
// to one page via account_id (the conversation's page, passed by the tool — never the
// LLM). Returns a ready-to-read labelled block so the agent states these as its own
// knowledge. `found` is false when the page has no profile yet, so the agent knows not
// to invent. Never throws — a lookup hiccup must not break the reply.
export async function getPageInfo({ accountId } = {}) {
  const acct = parseInt(accountId, 10);
  if (!Number.isInteger(acct)) return { found: false, info: '' };
  try {
    const rows = await query('SELECT account_name, business_profile FROM platform_accounts WHERE id = ?', [acct]);
    if (!rows.length) return { found: false, info: '' };
    const info = formatBusinessProfile(rows[0].business_profile);
    return { found: !!info, name: rows[0].account_name || null, info };
  } catch {
    return { found: false, info: '' };
  }
}

// The AI agent's `check_delivery_distance` tool: how far is the customer's delivery
// address from THIS page's shop (the business_profile address)? Geocodes both via
// Geoapify and returns the DRIVING distance + time, so the Sales Agent can decide
// whether to push the online-store links for far addresses. SCOPED to one page via
// account_id. Returns { available:false, reason } whenever it can't compute one
// (no Geoapify key, no business address set, an address that won't geocode, etc.) —
// the agent then falls back to judging from the address text. Never throws.
export async function getDeliveryDistance({ accountId, address } = {}) {
  const acct = parseInt(accountId, 10);
  const dest = String(address ?? '').trim();
  if (!Number.isInteger(acct) || !dest) return { available: false, reason: 'missing_input' };
  if (!env.geoapify.apiKey) return { available: false, reason: 'not_configured' };
  try {
    const rows = await query('SELECT business_profile FROM platform_accounts WHERE id = ?', [acct]);
    if (!rows.length) return { available: false, reason: 'no_page' };
    const origin = String(parseBusinessProfile(rows[0].business_profile).address || '').trim();
    if (!origin) return { available: false, reason: 'no_business_address' };

    // Geocode shop + customer in parallel (the shop result is cached after the first call).
    const [from, to] = await Promise.all([geoapify.geocode(origin), geoapify.geocode(dest)]);
    if (!from) return { available: false, reason: 'business_address_not_found' };
    if (!to) return { available: false, reason: 'address_not_found' };

    const route = await geoapify.driveDistance(from, to);
    if (!route) return { available: false, reason: 'route_failed' };

    return {
      available: true,
      distanceKm: Math.round((route.meters / 1000) * 10) / 10,
      durationMin: route.seconds != null ? Math.round(route.seconds / 60) : null,
      origin: from.formatted,
      destination: to.formatted,
    };
  } catch {
    return { available: false, reason: 'error' };
  }
}

// The AI agent's `send_media` tool: find media in THIS page's Vault folder matching
// the query and deliver it to the customer (same outgoing path as any media —
// Telegram/Messenger sendMedia + inbox bubble + SSE). One call can send several
// files — `count` (1–10, default 1) is how many distinct matches to send — so "send
// all your packages" is a single broad-query call, not many repeated single sends.
// Scoped to the page's folder and skips ai_hidden files; accountId/customerHandle
// come from the conversation (the tool), never the LLM. Returns a short status the
// agent speaks to.
export async function sendVaultMedia({ accountId, customerHandle, origin, query: rawQuery, count } = {}) {
  const acct = parseInt(accountId, 10);
  const handle = String(customerHandle ?? '').trim();
  const q = String(rawQuery ?? '').trim();
  if (!Number.isInteger(acct) || !handle || !q) {
    return { sent: false, reason: 'accountId, customerHandle, and query are required' };
  }

  // How many distinct files to send this call. Default 1 (a single best match —
  // "show me X"); the agent raises it to send a set ("send all your packages").
  // Hard-capped at 10 so one broad query can't flood the customer.
  let want = parseInt(count, 10);
  if (!Number.isFinite(want) || want < 1) want = 1;
  want = Math.min(want, 10);

  const rows = await query('SELECT vault_folder_id FROM platform_accounts WHERE id = ?', [acct]);
  const folderId = rows.length ? rows[0].vault_folder_id : null;
  if (folderId == null) return { sent: false, reason: "this page has no media folder yet" };

  // Pull a few past `want` so any leftovers can be offered back as alternatives.
  const matches = await searchAiMedia(folderId, q, { limit: Math.min(want + 4, 10) });
  if (!matches.length) return { sent: false, reason: "no matching file found in this page's folder" };

  // searchAiMedia returns distinct rows, so picking the top `want` can't repeat a
  // file — this is what fixes the "same photo sent 3×" of repeated single sends.
  const picked = matches.slice(0, want);

  // One bubble carrying every picked file — deliverToCustomer fans it out into one
  // message per photo on the platform. side:'outgoing' + AI-handled → receiveInbound
  // delivers it to the customer (and won't, if a human has taken the thread over).
  await receiveInbound({
    accountId: acct,
    customerHandle: handle,
    origin,
    side: 'outgoing',
    media: picked.map((m) => ({ type: m.mediaType, url: m.url, name: m.name })),
  });

  // Tell the agent what actually went out (so it can caption accurately) plus any
  // matches it didn't send (so it can offer them).
  return {
    sent: true,
    count: picked.length,
    files: picked.map((m) => ({ name: m.name, description: m.description || '', tags: m.tags || [] })),
    alternatives: matches.slice(picked.length).map((m) => ({
      name: m.name,
      description: m.description || '',
      tags: m.tags || [],
    })),
  };
}
