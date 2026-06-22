// Minimal Telegram Bot API client. getMe validates a bot's API key (token) when
// connecting a Telegram channel in Settings (the counterpart to fb.verifyPageToken);
// sendMessage/sendMedia push a Live Agent's reply out to the customer's chat. The
// token IS the credential, stored encrypted in platform_accounts.telegram_bot_token;
// getMe returns the bot's id, @username and display name so we can identify and show
// it. (Inbound delivery still arrives via n8n -> /api/messages/inbound.)

// Telegram bot tokens look like "123456789:AA…" — digits, a colon, then a secret.
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

// Telegram only renders formatting when a parse_mode is set. Our agents emit a
// little CommonMark (**bold**, `code`, "- " bullets); convert that to Telegram-safe
// HTML so it shows as real bold/bullets instead of literal asterisks. All text is
// HTML-escaped first and we only ever emit balanced <b>/<code> tags, so the markup
// stays valid — and sendMessage falls back to plain text if Telegram still objects.
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function toTelegramHtml(text) {
  return escapeHtml(text)
    .replace(/^[ \t]*[-*]\s+/gm, '• ') // markdown bullet -> real bullet
    .replace(/`([^`\n]+?)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*(.+?)\*\*/g, (_, bold) => `<b>${bold}</b>`);
}
const looksLikeParseError = (description = '') => /parse|entit|tag|offset/i.test(description);

/**
 * Validate a Telegram bot token and fetch the bot's profile.
 * Returns { ok, id, username, name } on success, or { ok:false, error } otherwise.
 * Never throws — callers turn !ok into a 400 with the message.
 */
export async function getMe(token) {
  const t = String(token || '').trim();
  // Validate the shape first: the token goes into the URL path RAW (the ':' is a
  // legal path char and Telegram won't match a percent-encoded token), so we must
  // be sure nothing unexpected reaches the URL.
  if (!TOKEN_RE.test(t)) {
    return { ok: false, error: 'That does not look like a valid Telegram bot token (expected "<id>:<secret>").' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      return { ok: false, error: body?.description || `Telegram rejected the token (HTTP ${res.status}).` };
    }
    const r = body.result || {};
    return { ok: true, id: r.id ?? null, username: r.username || null, name: r.first_name || r.username || 'Telegram bot' };
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, error: 'Telegram timed out — try again.' };
    return { ok: false, error: `Couldn't reach Telegram: ${err.message}` };
  }
}

/**
 * Send a plain-text message from a bot to a chat. Best-effort: returns
 * { ok, messageId } or { ok:false, error }; never throws — callers log and move on.
 */
// Resolve a temporary download URL for an inbound file_id (photo/document/…). The
// URL embeds the bot token, so it's used server-side only (we fetch + re-store the
// bytes in S3). Returns the URL or null.
export async function getFileLink(token, fileId) {
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t) || !fileId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getFile?file_id=${encodeURIComponent(fileId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok || !body.result?.file_path) return null;
    return `https://api.telegram.org/file/bot${t}/${body.result.file_path}`;
  } catch {
    return null;
  }
}

export async function sendMessage(token, chatId, text, { replyToMessageId } = {}) {
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) return { ok: false, error: 'invalid bot token' };
  if (chatId == null || chatId === '') return { ok: false, error: 'missing chat id' };

  const raw = String(text ?? '');
  const base = { chat_id: chatId };
  const rid = Number(replyToMessageId);
  if (Number.isFinite(rid) && rid > 0) {
    base.reply_to_message_id = rid;
    base.allow_sending_without_reply = true; // don't fail if the original was deleted
  }

  const post = async (payload) => {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return { res, body: await res.json().catch(() => null) };
  };

  try {
    // Send formatted (HTML) first; if Telegram rejects the markup, resend as plain
    // text so the message still gets through.
    let { res, body } = await post({ ...base, text: toTelegramHtml(raw), parse_mode: 'HTML' });
    if ((!res.ok || !body?.ok) && looksLikeParseError(body?.description)) {
      ({ res, body } = await post({ ...base, text: raw }));
    }
    if (!res.ok || !body?.ok) return { ok: false, error: body?.description || `Telegram HTTP ${res.status}` };
    return { ok: true, messageId: body.result?.message_id ?? null };
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, error: 'Telegram timed out' };
    return { ok: false, error: err.message };
  }
}

/**
 * Send media by URL — images via sendPhoto, anything else via sendDocument.
 * Telegram fetches the URL itself, so it must be publicly reachable at send time
 * (vault presigned URLs are). Same best-effort contract as sendMessage.
 */
/**
 * Point a bot's inbound webhook at our gateway so Telegram pushes its updates there.
 * `secret` is echoed back by Telegram in the X-Telegram-Bot-Api-Secret-Token header
 * so we can verify the call. Best-effort — returns { ok } / { ok:false, error }.
 */
export async function setWebhook(token, url, secret) {
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) return { ok: false, error: 'invalid bot token' };
  if (!url) return { ok: false, error: 'missing url' };
  try {
    const payload = { url: String(url), allowed_updates: ['message', 'edited_message'] };
    if (secret) payload.secret_token = String(secret);
    const res = await fetch(`https://api.telegram.org/bot${t}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) return { ok: false, error: body?.description || `Telegram HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, error: 'Telegram timed out' };
    return { ok: false, error: err.message };
  }
}

// Remove a bot's webhook (when its bot is detached / the page is deleted).
export async function deleteWebhook(token) {
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) return { ok: false, error: 'invalid bot token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) return { ok: false, error: body?.description || `Telegram HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, error: 'Telegram timed out' };
    return { ok: false, error: err.message };
  }
}

/**
 * Read a bot's current webhook registration. Returns
 * { ok, url, pendingUpdateCount, lastErrorMessage } — url is '' when no webhook is
 * set. Used by the Settings "Refresh" action to confirm where Telegram is pointing.
 */
export async function getWebhookInfo(token) {
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) return { ok: false, error: 'invalid bot token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getWebhookInfo`, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) return { ok: false, error: body?.description || `Telegram HTTP ${res.status}` };
    const r = body.result || {};
    return {
      ok: true,
      url: r.url || '',
      pendingUpdateCount: r.pending_update_count ?? 0,
      lastErrorMessage: r.last_error_message || null,
    };
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, error: 'Telegram timed out' };
    return { ok: false, error: err.message };
  }
}

export async function sendMedia(token, chatId, { url, type, caption, replyToMessageId } = {}) {
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) return { ok: false, error: 'invalid bot token' };
  if (chatId == null || chatId === '' || !url) return { ok: false, error: 'missing chat id or url' };
  const isImage = String(type || '').toLowerCase().startsWith('image');
  const method = isImage ? 'sendPhoto' : 'sendDocument';
  const field = isImage ? 'photo' : 'document';
  const rawCaption = caption ? String(caption) : '';
  const base = { chat_id: chatId, [field]: String(url) };
  const rid = Number(replyToMessageId);
  if (Number.isFinite(rid) && rid > 0) {
    base.reply_to_message_id = rid;
    base.allow_sending_without_reply = true;
  }

  const post = async (payload) => {
    const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    return { res, body: await res.json().catch(() => null) };
  };

  try {
    const formatted = rawCaption
      ? { ...base, caption: toTelegramHtml(rawCaption), parse_mode: 'HTML' }
      : base;
    let { res, body } = await post(formatted);
    if (rawCaption && (!res.ok || !body?.ok) && looksLikeParseError(body?.description)) {
      ({ res, body } = await post({ ...base, caption: rawCaption }));
    }
    if (!res.ok || !body?.ok) return { ok: false, error: body?.description || `Telegram HTTP ${res.status}` };
    return { ok: true, messageId: body.result?.message_id ?? null };
  } catch (err) {
    if (err?.name === 'TimeoutError') return { ok: false, error: 'Telegram timed out' };
    return { ok: false, error: err.message };
  }
}
