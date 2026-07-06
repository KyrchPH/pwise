import { env } from '../config/env.js';
import { query } from '../config/db.js';
import * as messaging from './messaging.service.js';
import * as tg from './telegram.service.js';
import * as fb from './fb.service.js';
import * as wa from './whatsapp.service.js';
import { getDecrypted, getAiSystemMessages } from './platform_accounts.service.js';
import { putObject, createDownloadUrl } from './s3.service.js';
import * as appSettings from './app_settings.service.js';

/**
 * Inbound platform gateway. Each platform adapter turns a raw webhook payload into
 * ONE canonical message, records it (bound to its Facebook page), and — only while
 * the thread is AI-handled — forwards it to n8n for an AI reply. n8n stays fully
 * platform-agnostic; outbound sending happens server-side (messaging.service) using
 * the page's stored credential. Adapters: Telegram, Messenger, Instagram (shares the
 * Messenger walk — same envelope, resolved by instagram_account_id), and WhatsApp
 * (its own Cloud-API envelope, resolved by wa_phone_number_id).
 */

// Long-lived (7-day, the SigV4 max) presigned URL — inbound media URLs are stored on
// the message, so they need to outlast a single request.
const INBOUND_MEDIA_TTL = 7 * 24 * 60 * 60;

// Hand a normalized message to the n8n AI workflow. Fire-and-forget: a slow or
// down n8n must never block (or fail) the platform's webhook delivery.
async function forwardToAi(payload) {
  const dev = env.nodeEnv === 'development';
  // Global admin pause — record the customer's message in the inbox (already done by
  // the caller) but don't ask the AI to reply; agents answer manually meanwhile.
  if (await appSettings.isAiPaused()) {
    if (dev) console.log('[gateway] forwardToAi skipped: the AI Agent is paused (admin toggle).');
    return;
  }
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
      // it.headers carries auth when the source URL is token-gated (e.g. WhatsApp media).
      const res = await fetch(it.url, { headers: it.headers || {}, signal: AbortSignal.timeout(20_000) });
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
  // Blocked customer → drop silently (no record, no n8n forward).
  if (await messaging.isCustomerBlocked({ accountId: acct, customerHandle: chatId })) return;

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

// ── Messenger + Instagram (shared Meta Messaging envelope) ──────────────────────

// Both Messenger and Instagram deliver the SAME shape — all subscribed accounts' events
// in one POST, each `entry` tagged with its account id and carrying `messaging[]` events
// (customer id + message). They differ only in: body.object, which column maps the entry
// id to our account, and the origin/platform tag. resolveColumn is a fixed constant
// (never user input), so the interpolation is injection-safe.
async function handleMetaMessaging(body, { object, origin, platform, resolveColumn, defaultName }) {
  if (!body || body.object !== object || !Array.isArray(body.entry)) return;

  for (const entry of body.entry) {
    const externalAccountId = String(entry.id || '');
    if (!externalAccountId) continue;

    // Resolve the entry → our account (+ page token, for customer names) once per entry.
    let acct = null;
    let pageToken = '';
    try {
      const rows = await query(`SELECT id FROM platform_accounts WHERE ${resolveColumn} = ? LIMIT 1`, [externalAccountId]);
      if (rows.length) {
        acct = Number(rows[0].id);
        const acc = await getDecrypted(acct);
        pageToken = acc.access_token || '';
      }
    } catch {
      /* unknown account — record with no binding */
    }

    for (const event of entry.messaging || []) {
      const senderId = String(event.sender?.id || '');
      if (!senderId) continue;

      const message = event.message;
      if (message?.is_echo) continue; // our own outgoing, echoed back

      // Normalize either a real message OR a postback (button tap, incl. Get Started)
      // into one inbound record. Delivery/read receipts + reactions carry no content.
      let text = '';
      let rawMedia = [];
      let externalId = null;
      let postbackPayload = '';
      if (message) {
        text = String(message.text || '').trim();
        rawMedia = (Array.isArray(message.attachments) ? message.attachments : [])
          .filter((a) => a?.payload?.url)
          .map((a) => {
            const t = String(a.type || '').toLowerCase();
            return { url: a.payload.url, type: t === 'image' ? 'image' : t === 'video' ? 'video' : 'file', name: t || 'attachment' };
          });
        externalId = message.mid;
      } else if (event.postback) {
        // Treat the button's title as what the customer "said"; the raw payload rides
        // along to n8n so a workflow can route on it (e.g. GET_STARTED → a greeting).
        text = String(event.postback.title || event.postback.payload || '').trim();
        externalId = event.postback.mid ?? null;
        postbackPayload = String(event.postback.payload || '');
      } else {
        continue;
      }

      let media = [];
      if (rawMedia.length && acct != null) media = await ingestRemoteMedia(rawMedia, acct, platform);
      if (!text && !media.length) continue;
      // Blocked customer → drop silently (no record, no n8n forward).
      if (await messaging.isCustomerBlocked({ accountId: acct, customerHandle: senderId })) continue;

      let resolvedName = null;
      let customerAvatar = null;
      let profileMeta = null;
      if (pageToken) {
        const prof = await fb.getUserProfile(pageToken, senderId).catch(() => null);
        if (prof?.name) resolvedName = prof.name;
        if (prof?.avatar) customerAvatar = prof.avatar;
        profileMeta = prof?.meta || null;
      }
      const customerName = resolvedName || defaultName;

      // TEMP DIAGNOSTIC — rides along on the SSE event so it shows in the browser console
      // (the Meta lookup itself is server-side, so this is the only way to see it client
      // side). Remove once "Messenger user" is diagnosed.
      const debug = {
        origin,
        senderId,
        hasPageToken: !!pageToken,
        resolvedName,
        customerName,
        hasAvatar: !!customerAvatar,
        meta: profileMeta,
      };

      const result = await messaging.receiveInbound({
        accountId: acct,
        origin,
        side: 'incoming',
        text,
        media,
        customerHandle: senderId,
        customerName,
        // Only refresh the stored name when we actually resolved a REAL one — never
        // overwrite an existing good name with the generic "<platform> user" default.
        customerNameResolved: resolvedName,
        customerAvatar,
        externalId,
        debug,
      });

      if (text && aiShouldReply(result?.conversation)) {
        forwardToAi({
          accountId: acct,
          platform,
          chatId: senderId,
          text,
          ...(postbackPayload ? { postbackPayload } : {}),
          author: { first_name: customerName, last_name: '' },
        }).catch(() => {});
      }
    }
  }
}

// Messenger adapter — resolve the page by fb_page_id.
export async function handleMessengerEvent(body = {}) {
  return handleMetaMessaging(body, {
    object: 'page', origin: 'messenger', platform: 'messenger', resolveColumn: 'fb_page_id', defaultName: 'Messenger user',
  });
}

// Instagram adapter — same envelope as Messenger; resolve by instagram_account_id, and
// outbound replies reuse the page access token (Messenger Platform Send API).
export async function handleInstagramEvent(body = {}) {
  return handleMetaMessaging(body, {
    object: 'instagram', origin: 'instagram', platform: 'instagram', resolveColumn: 'instagram_account_id', defaultName: 'Instagram user',
  });
}

// ── WhatsApp (Cloud API) ────────────────────────────────────────────────────────

// The text payload differs by message type (text / button / interactive reply / media
// caption). Returns '' when there's nothing textual.
function extractWhatsappText(msg) {
  if (msg.type === 'text') return String(msg.text?.body || '').trim();
  if (msg.type === 'button') return String(msg.button?.text || '').trim();
  if (msg.type === 'interactive') {
    const i = msg.interactive || {};
    return String(i.button_reply?.title || i.list_reply?.title || '').trim();
  }
  const caption = msg[msg.type]?.caption;
  return caption ? String(caption).trim() : '';
}

// Resolve an inbound media message to a fetchable item for ingestRemoteMedia. The
// WhatsApp media URL is token-gated, so we carry the Bearer header through to the fetch.
async function extractWhatsappMedia(msg, token) {
  const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker', 'voice'];
  if (!MEDIA_TYPES.includes(msg.type)) return [];
  const obj = msg[msg.type];
  if (!obj?.id || !token) return [];
  const resolved = await wa.getMediaUrl(token, obj.id);
  if (!resolved?.url) return [];
  const mime = resolved.mimeType || obj.mime_type || '';
  const type = mime.startsWith('video') || msg.type === 'video' ? 'video'
    : mime.startsWith('image') || msg.type === 'image' || msg.type === 'sticker' ? 'image'
    : 'file';
  return [{ url: resolved.url, type, name: obj.filename || msg.type, mime, headers: { Authorization: `Bearer ${token}` } }];
}

// Delivery receipt → update our stored message's status by its wamid (external_id).
// We collapse delivered/read into 'sent' to stay within the inbox's known vocabulary.
async function applyWhatsappStatus(st) {
  const wamid = String(st?.id || '');
  if (!wamid) return;
  const s = String(st.status || '').toLowerCase();
  const status = ['sent', 'delivered', 'read'].includes(s) ? 'sent' : s === 'failed' ? 'failed' : null;
  if (!status) return;
  await query('UPDATE messages SET delivery_status = ? WHERE external_id = ?', [status, wamid]).catch(() => {});
}

// WhatsApp adapter — Cloud API delivers entry[].changes[].value with messages[] and/or
// statuses[]. The number is resolved by value.metadata.phone_number_id.
export async function handleWhatsappEvent(body = {}) {
  if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return;

  for (const entry of body.entry) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const phoneNumberId = String(value.metadata?.phone_number_id || '');

      let acct = null;
      let waToken = '';
      if (phoneNumberId) {
        try {
          const rows = await query('SELECT id FROM platform_accounts WHERE wa_phone_number_id = ? LIMIT 1', [phoneNumberId]);
          if (rows.length) {
            acct = Number(rows[0].id);
            const acc = await getDecrypted(acct);
            waToken = acc.wa_access_token || '';
          }
        } catch {
          /* unknown number — record with no binding */
        }
      }

      // Delivery receipts (best-effort; no live SSE — reflected on next load).
      for (const st of value.statuses || []) await applyWhatsappStatus(st);

      const contactName = value.contacts?.[0]?.profile?.name || 'WhatsApp user';
      for (const msg of value.messages || []) {
        const from = String(msg.from || '');
        if (!from) continue;
        const text = extractWhatsappText(msg);
        const rawMedia = await extractWhatsappMedia(msg, waToken);
        let media = [];
        if (rawMedia.length && acct != null) media = await ingestRemoteMedia(rawMedia, acct, 'whatsapp');
        if (!text && !media.length) continue;
        // Blocked customer → drop silently (no record, no n8n forward).
        if (await messaging.isCustomerBlocked({ accountId: acct, customerHandle: from })) continue;

        const result = await messaging.receiveInbound({
          accountId: acct,
          origin: 'whatsapp',
          side: 'incoming',
          text,
          media,
          customerHandle: from,
          customerName: contactName,
          externalId: msg.id,
        });

        if (text && aiShouldReply(result?.conversation)) {
          forwardToAi({ accountId: acct, platform: 'whatsapp', chatId: from, text, author: { first_name: contactName, last_name: '' } }).catch(() => {});
        }
      }
    }
  }
}
