import { env } from '../config/env.js';
import { query } from '../config/db.js';
import * as messaging from './messaging.service.js';
import * as tg from './telegram.service.js';
import * as fb from './fb.service.js';
import { getDecrypted, getAiSystemMessages } from './platform_accounts.service.js';
import { putObject, createDownloadUrl } from './s3.service.js';

/**
 * Inbound platform gateway. Each platform adapter turns a raw webhook payload into
 * ONE canonical message, records it (bound to its Facebook page), and — only while
 * the thread is AI-handled — forwards it to n8n for an AI reply. n8n stays fully
 * platform-agnostic; outbound sending happens server-side (messaging.service) using
 * the page's stored credential. Telegram and Messenger adapters live here; add a
 * WhatsApp/Instagram one the same way and nothing else needs to change.
 */

// Long-lived (7-day, the SigV4 max) presigned URL — inbound media URLs are stored on
// the message, so they need to outlast a single request.
const INBOUND_MEDIA_TTL = 7 * 24 * 60 * 60;

// Hand a normalized message to the n8n AI workflow. Fire-and-forget: a slow or
// down n8n must never block (or fail) the platform's webhook delivery.
async function forwardToAi(payload) {
  const dev = env.nodeEnv === 'development';
  if (!env.n8n.aiWebhookUrl) {
    if (dev) console.warn('[gateway] forwardToAi skipped: N8N_AI_WEBHOOK_URL is not set — nothing is sent to n8n.');
    return;
  }
  if (dev) console.log(`[gateway] forwarding ${payload.platform} chat ${payload.chatId} -> ${env.n8n.aiWebhookUrl}`);
  // Attach this page's per-agent system prompts (admin-configured persona + the
  // immutable guardrails). Composer falls back to defaults; this never throws.
  let agentPrompts = {};
  try {
    agentPrompts = await getAiSystemMessages(payload.accountId);
  } catch (e) {
    if (dev) console.warn(`[gateway] could not load AI prompts (sending without): ${e?.message || e}`);
  }
  try {
    const res = await fetch(env.n8n.aiWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.n8n.aiSecret ? { 'x-gateway-secret': env.n8n.aiSecret } : {}),
      },
      body: JSON.stringify({ ...payload, ...agentPrompts }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.warn(`[gateway] n8n forward HTTP ${res.status} (is the workflow Active? does the path match its production URL?)`);
    else if (dev) console.log(`[gateway] n8n forward ok (HTTP ${res.status})`);
  } catch (e) {
    console.warn(`[gateway] n8n forward failed: ${e?.message || e}`);
  }
}

// Whether the AI should auto-reply to this thread. The AI handles unbound 'AI Agent'
// threads — UNLESS it has escalated the thread to a human (HANDOFF_STATUS), in which
// case we stay quiet until an agent takes over (which clears the status). A Live Agent
// takeover also flips handledBy, so that path is covered too.
function aiShouldReply(conv) {
  return conv?.handledBy === 'AI Agent' && conv?.status !== messaging.HANDOFF_STATUS;
}

// Fetch each remote media URL and re-store it in S3 so the inbox can show it via a
// normal presigned URL (shared by every platform adapter). items: [{ url, type, name }].
async function ingestRemoteMedia(items, accountId, platform) {
  const out = [];
  for (const it of items) {
    try {
      if (!it.url) continue;
      const res = await fetch(it.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || it.mime || 'application/octet-stream';
      const safeName = String(it.name || 'file').replace(/[^\w.\-]+/g, '_');
      const key = `inbound/${platform}/${accountId ?? 'na'}/${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
      await putObject(key, bytes, contentType);
      const url = await createDownloadUrl(key, INBOUND_MEDIA_TTL);
      out.push({ type: it.type, url, name: it.name });
    } catch (e) {
      console.warn(`[gateway] ${platform} media ingest failed: ${e?.message || e}`);
    }
  }
  return out;
}

// ── Telegram ──────────────────────────────────────────────────────────────────

// Pull the attachable media out of a Telegram message → [{ fileId, type, name, mime }].
function extractTelegramMedia(msg) {
  const out = [];
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1]; // last size = highest resolution
    out.push({ fileId: largest.file_id, type: 'image', name: 'photo.jpg', mime: 'image/jpeg' });
  }
  if (msg.video) {
    out.push({ fileId: msg.video.file_id, type: 'video', name: msg.video.file_name || 'video.mp4', mime: msg.video.mime_type || 'video/mp4' });
  }
  if (msg.document) {
    const mime = msg.document.mime_type || 'application/octet-stream';
    const type = mime.startsWith('image') ? 'image' : mime.startsWith('video') ? 'video' : 'file';
    out.push({ fileId: msg.document.file_id, type, name: msg.document.file_name || 'file', mime });
  }
  if (msg.audio) out.push({ fileId: msg.audio.file_id, type: 'file', name: msg.audio.file_name || 'audio', mime: msg.audio.mime_type || 'audio/mpeg' });
  if (msg.voice) out.push({ fileId: msg.voice.file_id, type: 'file', name: 'voice.ogg', mime: msg.voice.mime_type || 'audio/ogg' });
  return out;
}

// Resolve each Telegram file_id to its (token-gated) URL, then ingest via S3.
async function ingestTelegramMedia(botToken, rawMedia, accountId) {
  const items = [];
  for (const it of rawMedia) {
    const link = await tg.getFileLink(botToken, it.fileId);
    if (link) items.push({ url: link, type: it.type, name: it.name, mime: it.mime });
  }
  return ingestRemoteMedia(items, accountId, 'telegram');
}

// Telegram adapter — normalize an Update (text + media), record it (bound to the
// page from the ?accountId tag), and forward to n8n when AI-handled with text.
export async function handleTelegramUpdate(accountId, update = {}) {
  const msg = update.message || update.edited_message;
  if (!msg) return; // ignore non-message updates (callbacks, joins, …)

  const text = String(msg.text || msg.caption || '').trim();
  const acct = accountId != null && accountId !== '' ? Number(accountId) : null;

  let media = [];
  const rawMedia = extractTelegramMedia(msg);
  if (rawMedia.length && acct != null) {
    try {
      const acc = await getDecrypted(acct);
      if (acc.telegram_bot_token) media = await ingestTelegramMedia(acc.telegram_bot_token, rawMedia, acct);
    } catch (e) {
      console.warn(`[gateway] telegram media setup failed: ${e?.message || e}`);
    }
  }
  if (!text && !media.length) return;

  const from = msg.from || {};
  const customerName = `${from.first_name || ''} ${from.last_name || ''}`.trim() || from.username || 'Customer';
  const chatId = String(msg.chat?.id ?? from.id ?? '');
  if (!chatId) return;

  const result = await messaging.receiveInbound({
    accountId: acct,
    origin: 'telegram',
    side: 'incoming',
    text,
    media,
    customerHandle: chatId,
    customerName,
    externalId: msg.message_id,
  });

  if (text && aiShouldReply(result?.conversation)) {
    forwardToAi({ accountId: acct, platform: 'telegram', chatId, text, author: { first_name: from.first_name || '', last_name: from.last_name || '' } }).catch(() => {});
  } else if (env.nodeEnv === 'development') {
    console.log(
      `[gateway] telegram recorded but NOT forwarded to AI: text=${text ? 'present' : 'empty'} ` +
        `handledBy=${result?.conversation?.handledBy ?? '(none)'} status=${result?.conversation?.status || '(none)'} ` +
        '(forwarded only for non-empty text on an AI Agent thread that has not been handed off to a human).',
    );
  }
}

// ── Messenger ─────────────────────────────────────────────────────────────────

// Messenger adapter — FB delivers all subscribed pages' events in one POST; each
// `entry` is tagged with its page id, each `messaging` event carries the customer
// PSID + message. We resolve the page → account, ingest media, record, and forward.
export async function handleMessengerEvent(body = {}) {
  if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return;

  for (const entry of body.entry) {
    const pageId = String(entry.id || '');
    if (!pageId) continue;

    // Resolve the page → our account (+ page token, for names) once per entry.
    let acct = null;
    let pageToken = '';
    try {
      const rows = await query('SELECT id FROM platform_accounts WHERE fb_page_id = ? LIMIT 1', [pageId]);
      if (rows.length) {
        acct = Number(rows[0].id);
        const acc = await getDecrypted(acct);
        pageToken = acc.access_token || '';
      }
    } catch {
      /* unknown page — record with no account binding */
    }

    for (const event of entry.messaging || []) {
      const message = event.message;
      if (!message || message.is_echo) continue; // skip echoes / delivery+read receipts
      const psid = String(event.sender?.id || '');
      if (!psid) continue;

      const text = String(message.text || '').trim();
      const rawMedia = (Array.isArray(message.attachments) ? message.attachments : [])
        .filter((a) => a?.payload?.url)
        .map((a) => {
          const t = String(a.type || '').toLowerCase();
          return { url: a.payload.url, type: t === 'image' ? 'image' : t === 'video' ? 'video' : 'file', name: t || 'attachment' };
        });
      let media = [];
      if (rawMedia.length && acct != null) media = await ingestRemoteMedia(rawMedia, acct, 'messenger');
      if (!text && !media.length) continue;

      let customerName = 'Messenger user';
      if (pageToken) {
        const prof = await fb.getUserProfile(pageToken, psid).catch(() => null);
        if (prof?.name) customerName = prof.name;
      }

      const result = await messaging.receiveInbound({
        accountId: acct,
        origin: 'messenger',
        side: 'incoming',
        text,
        media,
        customerHandle: psid,
        customerName,
        externalId: message.mid,
      });

      if (text && aiShouldReply(result?.conversation)) {
        forwardToAi({ accountId: acct, platform: 'messenger', chatId: psid, text, author: { first_name: customerName, last_name: '' } }).catch(() => {});
      }
    }
  }
}
