import crypto from 'node:crypto';
import asyncHandler from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import * as gateway from '../services/inbound_gateway.service.js';

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

// Facebook Messenger webhook verification handshake (GET): echo hub.challenge back
// when the verify token matches the one we configured in the FB App dashboard.
export const messengerVerify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && env.facebook.verifyToken && token === env.facebook.verifyToken) {
    res.status(200).send(String(req.query['hub.challenge'] ?? ''));
    return;
  }
  res.sendStatus(403);
};

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
  console.log(
    `[webhooks:messenger] update received object=${req.body?.object ?? '?'} entries=${entries.length} events=${events}`,
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
});
