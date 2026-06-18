// Minimal Telegram Bot API client. Today it only validates a bot's API key (token)
// via getMe — used when connecting a Telegram channel in Settings (the counterpart
// to fb.verifyPageToken). The token IS the credential, stored encrypted as the
// account's access_token; getMe returns the bot's id, @username and display name so
// we can identify and show it. (Sending/receiving messages is a later step.)

// Telegram bot tokens look like "123456789:AA…" — digits, a colon, then a secret.
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

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
