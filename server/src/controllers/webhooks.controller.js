import crypto from 'node:crypto';
import asyncHandler from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import * as gateway from '../services/inbound_gateway.service.js';
import { handleFeedEvent } from '../services/comment_realtime.service.js';

// Public inbound webhooks from messaging platforms (no JWT — each platform verifies
// itself). The page is identified by the ?accountId tag we registered per bot.
export const telegram = asyncHandler(async (req, res) => {
  // Log every inbound hit BEFORE the secret check, so "is Telegram even reaching us?"
  // is answerable on ANY deploy (incl. production) and a secret mismatch is still
  // visible. The one-line summary always prints; the full payload is dev-only, to keep
  // production logs lean and free of customer PII.
  const tgMsg = req.body?.message || req.body?.edited_message || {};
  console.log(
    `[webhooks:telegram] update received accountId=${req.query.accountId ?? '(none)'} ` +
      `update_id=${req.body?.update_id ?? '?'} chat=${tgMsg.chat?.id ?? '?'} ` +
      `secret_token=${req.headers['x-telegram-bot-api-secret-token'] ? 'present' : 'absent'} ` +
      `text=${JSON.stringify(String(tgMsg.text || tgMsg.caption || '').slice(0, 80))}`,
  );
  if (env.nodeEnv === 'development') {
    console.log(`[webhooks:telegram] payload\n${JSON.stringify(req.body ?? {}, null, 2)}`);
  }
  // Verify the secret_token Telegram echoes back (set when we registered the webhook).
  if (env.telegramWebhookSecret) {
    if (req.headers['x-telegram-bot-api-secret-token'] !== env.telegramWebhookSecret) {
      console.warn(
        '[webhooks:telegram] rejected (401): secret_token mismatch — TELEGRAM_WEBHOOK_SECRET ' +
          'differs from the value Telegram was given at setWebhook time. Reconnect the bot to re-register.',
      );
      res.status(401).json({ ok: false });
      return;
    }
  }
  // Ack immediately so Telegram doesn't retry; process the update in the background.
  res.json({ ok: true });
  gateway
    .handleTelegramUpdate(req.query.accountId, req.body || {})
    .catch((e) => console.warn(`[webhooks] telegram handler error: ${e?.message || e}`));
});

// Meta webhook verification handshake (GET): echo hub.challenge back when the verify
// token matches the one configured in the Meta App dashboard. ONE handler for all three
// Meta products (Messenger, Instagram, WhatsApp) — they're a single app and share the
// verify token. `messengerVerify` is kept as an alias for the existing route.
export const metaVerify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && env.facebook.verifyToken && token === env.facebook.verifyToken) {
    res.status(200).send(String(req.query['hub.challenge'] ?? ''));
    return;
  }
  res.sendStatus(403);
};
export const messengerVerify = metaVerify;

// Verify FB's X-Hub-Signature-256 over the raw body (skipped if no app secret set).
function verifyFbSignature(req) {
  if (!env.facebook.appSecret) return true;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', env.facebook.appSecret).update(req.rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Messenger inbound (POST): all subscribed pages' messaging events land here, each
// entry tagged with its page id. Ack fast; process in the background.
export const messenger = asyncHandler(async (req, res) => {
  // Log arrival BEFORE signature verification, so a failed signature still shows the
  // hit. One-line summary always prints; full payload is dev-only.
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
  const events = entries.reduce((n, e) => n + (Array.isArray(e.messaging) ? e.messaging.length : 0), 0);
  // `feed` comment events arrive under entry[].changes[] (not messaging[]) — count them
  // too so their arrival is visible in production logs (where full payloads aren't printed).
  const changes = entries.reduce((n, e) => n + (Array.isArray(e.changes) ? e.changes.length : 0), 0);
  console.log(
    `[webhooks:messenger] update received object=${req.body?.object ?? '?'} entries=${entries.length} events=${events} changes=${changes}`,
  );
  if (env.nodeEnv === 'development') {
    console.log(`[webhooks:messenger] payload\n${JSON.stringify(req.body ?? {}, null, 2)}`);
  }
  if (!verifyFbSignature(req)) {
    console.warn('[webhooks:messenger] rejected (401): X-Hub-Signature-256 missing or mismatched (check FB_APP_SECRET).');
    res.sendStatus(401);
    return;
  }
  res.status(200).send('EVENT_RECEIVED');
  gateway
    .handleMessengerEvent(req.body || {})
    .catch((e) => console.warn(`[webhooks] messenger handler error: ${e?.message || e}`));
  // The same page webhook also carries `feed` changes (comments) under entry[].changes[];
  // push new/removed comments to the live Comments inbox over SSE.
  handleFeedEvent(req.body || {}).catch((e) => console.warn(`[webhooks] feed handler error: ${e?.message || e}`));
});

// Instagram messaging inbound (POST). Same envelope as Messenger (object:"instagram",
// entry[].messaging[]); the IG account is resolved by the entry id. Ack fast; process
// in the background. Shares the Meta app secret for the signature check.
export const instagram = asyncHandler(async (req, res) => {
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
  console.log(`[webhooks:instagram] update received object=${req.body?.object ?? '?'} entries=${entries.length}`);
  if (env.nodeEnv === 'development') {
    console.log(`[webhooks:instagram] payload\n${JSON.stringify(req.body ?? {}, null, 2)}`);
  }
  if (!verifyFbSignature(req)) {
    console.warn('[webhooks:instagram] rejected (401): X-Hub-Signature-256 missing or mismatched (check FB_APP_SECRET).');
    res.sendStatus(401);
    return;
  }
  res.status(200).send('EVENT_RECEIVED');
  gateway
    .handleInstagramEvent(req.body || {})
    .catch((e) => console.warn(`[webhooks] instagram handler error: ${e?.message || e}`));
});

// WhatsApp Cloud API inbound (POST). object:"whatsapp_business_account",
// entry[].changes[].value.{messages,statuses}; the number is resolved by
// value.metadata.phone_number_id. Ack fast; process in the background.
export const whatsapp = asyncHandler(async (req, res) => {
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
  console.log(`[webhooks:whatsapp] update received object=${req.body?.object ?? '?'} entries=${entries.length}`);
  if (env.nodeEnv === 'development') {
    console.log(`[webhooks:whatsapp] payload\n${JSON.stringify(req.body ?? {}, null, 2)}`);
  }
  if (!verifyFbSignature(req)) {
    console.warn('[webhooks:whatsapp] rejected (401): X-Hub-Signature-256 missing or mismatched (check FB_APP_SECRET).');
    res.sendStatus(401);
    return;
  }
  res.status(200).send('EVENT_RECEIVED');
  gateway
    .handleWhatsappEvent(req.body || {})
    .catch((e) => console.warn(`[webhooks] whatsapp handler error: ${e?.message || e}`));
});
