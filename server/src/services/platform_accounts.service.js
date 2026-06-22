import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { encrypt, decrypt } from '../utils/crypto.util.js';
import * as fb from './fb.service.js';
import * as tg from './telegram.service.js';
import { createFolder } from './vault.service.js';
import { env } from '../config/env.js';

// Connected Facebook pages. The list is shared/global (like the post pool); user_id
// is the admin creator (audit). Secrets (app_secret, app_client_token, access_token)
// are stored encrypted and NEVER returned to the browser. A page may OPTIONALLY have
// a Telegram bot attached (a bot can't exist without a page) — its API key lives in
// the encrypted telegram_bot_token column alongside the page's own credentials.

function toSafe(r) {
  return {
    id: r.id,
    account_name: r.account_name,
    fb_page_id: r.fb_page_id,
    app_id: r.app_id,
    // Optional Telegram bot attached to this page (the token itself is never exposed;
    // has_telegram_bot just says whether one is configured).
    telegram_bot_name: r.telegram_bot_name || null,
    telegram_bot_username: r.telegram_bot_username || null,
    has_telegram_bot: !!r.telegram_bot_token,
    is_active: !!r.is_active,
    // The page's dedicated Vault folder (the AI agent's media scope).
    vault_folder_id: r.vault_folder_id != null ? Number(r.vault_folder_id) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function list() {
  const rows = await query(
    "SELECT * FROM platform_accounts WHERE platform_name = 'facebook' ORDER BY created_at ASC",
  );
  return rows.map(toSafe);
}

export async function getById(id) {
  const rows = await query('SELECT * FROM platform_accounts WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('page not found');
  return toSafe(rows[0]);
}

// Internal only — full row with decrypted credentials (for posting / Graph calls /
// future Telegram sends). Never wire this to a client-facing response.
export async function getDecrypted(id) {
  const rows = await query('SELECT * FROM platform_accounts WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('page not found');
  const r = rows[0];
  return {
    id: r.id,
    account_name: r.account_name,
    fb_page_id: r.fb_page_id,
    app_id: r.app_id,
    app_secret: decrypt(r.app_secret),
    app_client_token: decrypt(r.app_client_token),
    access_token: decrypt(r.access_token),
    telegram_bot_name: r.telegram_bot_name || null,
    telegram_bot_username: r.telegram_bot_username || null,
    telegram_bot_token: decrypt(r.telegram_bot_token),
    is_active: !!r.is_active,
  };
}

function requireStr(value, label) {
  const s = String(value ?? '').trim();
  if (!s) throw ApiError.badRequest(`${label} is required`);
  return s;
}

// Validate a Telegram bot API key against Telegram (getMe) and return the columns
// to write: { token (encrypted), username }. Throws on an invalid key. Used by
// create/update when a page is given a bot.
async function resolveTelegramBot(apiKey) {
  const me = await tg.getMe(apiKey);
  if (!me.ok) throw ApiError.badRequest(me.error || 'Invalid Telegram bot API key');
  return { token: encrypt(String(apiKey).trim()), username: me.username || null };
}

// Register this page's Telegram bot webhook with Telegram so inbound messages reach
// our gateway tagged with the account id. Best-effort — a Telegram hiccup must not
// fail the page save.
async function ensureTelegramWebhook(accountId) {
  if (!env.publicUrl) return;
  try {
    const a = await getDecrypted(accountId);
    if (!a.telegram_bot_token) return;
    const url = `${env.publicUrl}/api/webhooks/telegram?accountId=${accountId}`;
    const r = await tg.setWebhook(a.telegram_bot_token, url, env.telegramWebhookSecret);
    if (!r.ok) console.warn(`[accounts] setWebhook failed (account ${accountId}): ${r.error}`);
  } catch (e) {
    console.warn(`[accounts] ensureTelegramWebhook error: ${e?.message || e}`);
  }
}

// Subscribe this page to the app's Messenger webhooks so its inbound messages reach
// /api/webhooks/messenger. Only attempted when Messenger is configured (a verify
// token is set). Best-effort.
async function ensureMessengerSubscription(accountId) {
  if (!env.facebook.verifyToken) return;
  try {
    const a = await getDecrypted(accountId);
    if (!a.access_token || !a.fb_page_id) return;
    const r = await fb.subscribeMessaging(a.access_token, a.fb_page_id);
    if (!r.ok) console.warn(`[accounts] messenger subscribe failed (account ${accountId}): ${r.error}`);
  } catch (e) {
    console.warn(`[accounts] ensureMessengerSubscription error: ${e?.message || e}`);
  }
}

// Re-register this page's inbound webhooks with the platforms — the Settings
// "Refresh" action. Unlike create/update it changes no stored credentials: it just
// re-points Telegram's setWebhook (and re-subscribes Messenger) at our gateway, then
// reads back the live Telegram registration so the UI can confirm it. Throws only on
// a hard precondition (page missing, or PUBLIC_URL unset so registration is
// impossible); per-platform outcomes come back in the result.
export async function refreshWebhook(id) {
  const account = await getDecrypted(id); // 404s if the page doesn't exist
  if (!env.publicUrl) {
    throw ApiError.badRequest(
      'PUBLIC_URL is not set on the server, so inbound webhooks cannot be registered. Set PUBLIC_URL and restart, then try again.',
    );
  }

  const result = { telegram: null, messenger: null };

  if (account.telegram_bot_token) {
    const url = `${env.publicUrl}/api/webhooks/telegram?accountId=${id}`;
    const set = await tg.setWebhook(account.telegram_bot_token, url, env.telegramWebhookSecret);
    if (!set.ok) {
      result.telegram = { ok: false, url, error: set.error };
    } else {
      // Confirm what Telegram actually has now (best-effort — the set already succeeded).
      const info = await tg.getWebhookInfo(account.telegram_bot_token);
      result.telegram = {
        ok: true,
        url,
        registeredUrl: info.ok ? info.url : null,
        pendingUpdateCount: info.ok ? info.pendingUpdateCount : null,
        lastErrorMessage: info.ok ? info.lastErrorMessage : null,
      };
    }
  }

  if (env.facebook.verifyToken && account.access_token && account.fb_page_id) {
    const sub = await fb.subscribeMessaging(account.access_token, account.fb_page_id);
    result.messenger = sub.ok ? { ok: true } : { ok: false, error: sub.error };
  }

  return result;
}

// Validate page credentials against Facebook BEFORE saving (the "Connect" step).
// For edits, a blank token / page id falls back to the stored values so an admin
// can re-test without re-entering secrets. Throws on failure.
export async function testConnection({ id, fb_page_id, access_token } = {}) {
  let token = access_token ? String(access_token).trim() : '';
  let pageId = fb_page_id ? String(fb_page_id).trim() : '';
  if ((!token || !pageId) && id != null) {
    const existing = await getDecrypted(id).catch(() => null);
    if (existing) {
      token = token || existing.access_token || '';
      pageId = pageId || existing.fb_page_id || '';
    }
  }
  if (!token) throw ApiError.badRequest('A page access token is required to test the connection.');
  if (!pageId) throw ApiError.badRequest('A Facebook Page ID is required to test the connection.');
  const result = await fb.verifyPageToken({ token, fbPageId: pageId });
  if (!result.ok) throw ApiError.badRequest(result.error || 'Connection failed.');
  return { ok: true, name: result.name, followers: result.followers ?? null };
}

export async function create(actor = {}, data = {}) {
  const account_name = requireStr(data.account_name, 'page name');
  const fb_page_id = requireStr(data.fb_page_id, 'Facebook Page ID');
  const access_token = requireStr(data.access_token, 'page access token');

  // Optional Telegram bot attached to this page. Only set when an API key is given;
  // the key is validated (and the @username captured) via getMe.
  let tgName = null;
  let tgToken = null;
  let tgUsername = null;
  const apiKey = data.telegram_api_key ? String(data.telegram_api_key).trim() : '';
  if (apiKey) {
    const resolved = await resolveTelegramBot(apiKey);
    tgToken = resolved.token;
    tgUsername = resolved.username;
    tgName = (data.telegram_bot_name && String(data.telegram_bot_name).trim()) || tgUsername || 'Telegram bot';
  }

  const result = await query(
    `INSERT INTO platform_accounts
       (user_id, platform_name, account_name, fb_page_id, app_id, app_secret, app_client_token, access_token,
        telegram_bot_name, telegram_bot_token, telegram_bot_username, is_active)
     VALUES (?, 'facebook', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      actor.id ?? null,
      account_name,
      fb_page_id,
      data.app_id ? String(data.app_id).trim() : null,
      encrypt(data.app_secret),
      encrypt(data.app_client_token),
      encrypt(access_token),
      tgName,
      tgToken,
      tgUsername,
    ],
  );
  // Give the page its own Vault folder — the AI agent's media scope. Best-effort:
  // a hiccup here must not fail the connect (the vault:backfill-folders script repairs it).
  try {
    const folder = await createFolder(actor, { name: account_name });
    await query('UPDATE platform_accounts SET vault_folder_id = ? WHERE id = ?', [folder.id, result.insertId]);
  } catch (err) {
    console.warn(`[platform_accounts] vault folder not created for page ${result.insertId}: ${err?.message || err}`);
  }

  const account = await getById(result.insertId);
  if (tgToken) ensureTelegramWebhook(account.id).catch(() => {}); // wire up the bot's webhook
  ensureMessengerSubscription(account.id).catch(() => {});
  return account;
}

export async function update(id, data = {}) {
  const existing = await getById(id); // existence (+ whether a bot is already attached)
  // Capture the current bot token before we (maybe) null it, so we can drop its webhook.
  const oldTgToken = data.telegram_remove
    ? await getDecrypted(id).then((a) => a.telegram_bot_token).catch(() => null)
    : null;
  const fields = [];
  const params = [];
  const set = (col, val) => {
    fields.push(`${col} = ?`);
    params.push(val);
  };
  if (data.account_name !== undefined) set('account_name', requireStr(data.account_name, 'page name'));
  if (data.fb_page_id !== undefined) set('fb_page_id', requireStr(data.fb_page_id, 'Facebook Page ID'));
  if (data.app_id !== undefined) set('app_id', data.app_id ? String(data.app_id).trim() : null);
  if (data.is_active !== undefined) set('is_active', data.is_active ? 1 : 0);
  // Secrets are write-only: only re-encrypt when a non-empty value is given
  // (blank input on the edit form = keep the existing encrypted value).
  if (data.app_secret) set('app_secret', encrypt(data.app_secret));
  if (data.app_client_token) set('app_client_token', encrypt(data.app_client_token));
  if (data.access_token) set('access_token', encrypt(data.access_token));

  // Optional Telegram bot: detach it, (re)connect a key, and/or rename it.
  if (data.telegram_remove) {
    set('telegram_bot_name', null);
    set('telegram_bot_token', null);
    set('telegram_bot_username', null);
  } else {
    const apiKey = data.telegram_api_key ? String(data.telegram_api_key).trim() : '';
    if (apiKey) {
      const resolved = await resolveTelegramBot(apiKey);
      set('telegram_bot_token', resolved.token);
      set('telegram_bot_username', resolved.username);
    }
    // Only persist a bot name when there's actually a bot (an incoming key now, or
    // one already attached) — avoids leaving a dangling name with no token.
    if (data.telegram_bot_name !== undefined && (apiKey || existing.has_telegram_bot)) {
      set('telegram_bot_name', String(data.telegram_bot_name).trim() || existing.telegram_bot_username || 'Telegram bot');
    }
  }

  if (fields.length) {
    params.push(id);
    await query(`UPDATE platform_accounts SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  // Keep the page's Vault folder name in sync with the page name (cosmetic; the link
  // is by id). Best-effort.
  if (data.account_name !== undefined && existing.vault_folder_id) {
    await query("UPDATE vault_items SET name = ? WHERE id = ? AND type = 'folder'", [
      String(data.account_name).trim(),
      existing.vault_folder_id,
    ]).catch(() => {});
  }
  // Keep the Telegram webhook in sync with the new bot state.
  if (data.telegram_remove) {
    if (oldTgToken) tg.deleteWebhook(oldTgToken).catch(() => {});
  } else if (data.telegram_api_key || existing.has_telegram_bot) {
    ensureTelegramWebhook(id).catch(() => {});
  }
  ensureMessengerSubscription(id).catch(() => {});
  return getById(id);
}

export async function remove(id) {
  await getById(id); // 404 if already gone
  // Drop the Telegram webhook (if any) before the row goes.
  const tok = await getDecrypted(id).then((a) => a.telegram_bot_token).catch(() => null);
  if (tok) tg.deleteWebhook(tok).catch(() => {});
  // Null references first — migrated DBs have no DB-level FK (see migration 012).
  await query('UPDATE post_pool SET account_id = NULL WHERE account_id = ?', [id]);
  await query('UPDATE posting_settings SET selected_account_id = NULL WHERE selected_account_id = ?', [id]);
  await query('DELETE FROM platform_accounts WHERE id = ?', [id]);
  statsCache.delete(Number(id));
  return { id: Number(id), deleted: true };
}

// Live-ish page profile stats (followers + name) for the sidebar's active-page
// widget. Reading followers_count needs the (decrypted) page token, so this can't
// be done client-side. Cached briefly — the sidebar loads on every page, so we
// don't want a Graph call each time. Best-effort: null on any error.
const statsCache = new Map(); // accountId -> { at, data }
const STATS_TTL_MS = 10 * 60 * 1000;

export async function getStats(accountId) {
  if (accountId == null) return null;
  const id = Number(accountId);
  const cached = statsCache.get(id);
  if (cached && Date.now() - cached.at < STATS_TTL_MS) return cached.data;
  let data = null;
  try {
    const a = await getDecrypted(id);
    const profile = await fb.fetchPageProfile({ token: a.access_token, fbPageId: a.fb_page_id });
    if (profile) data = { followers: profile.followers ?? profile.fans ?? null, name: profile.name ?? null };
  } catch {
    /* best-effort — leave null */
  }
  statsCache.set(id, { at: Date.now(), data });
  return data;
}

// Re-sync every connected page's display data from Facebook: pull the live
// name + followers with the stored token, correct a stale account_name (e.g.
// the "Imported page" placeholder), refresh the stats cache, and report which
// pages failed so the UI can flag them. Best-effort per page — one expired
// token doesn't abort the rest. Returns [{ id, ok, name, followers }].
export async function refreshAll() {
  const rows = await query(
    "SELECT id, account_name FROM platform_accounts WHERE platform_name = 'facebook' ORDER BY created_at ASC",
  );
  const results = [];
  for (const row of rows) {
    const id = Number(row.id);
    let ok = false;
    let name = null;
    let followers = null;
    try {
      const a = await getDecrypted(id);
      const profile = await fb.fetchPageProfile({ token: a.access_token, fbPageId: a.fb_page_id });
      if (profile && profile.name) {
        ok = true;
        name = profile.name;
        followers = profile.followers ?? profile.fans ?? null;
        if (name !== row.account_name) {
          await query('UPDATE platform_accounts SET account_name = ? WHERE id = ?', [name, id]);
        }
        statsCache.set(id, { at: Date.now(), data: { followers, name } });
      }
    } catch {
      /* token rejected / network error — reported as ok:false below */
    }
    if (!ok) statsCache.set(id, { at: Date.now(), data: null }); // drop stale followers for a dead token
    results.push({ id, ok, name, followers });
  }
  return results;
}
