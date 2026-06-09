import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { encrypt, decrypt } from '../utils/crypto.util.js';
import * as fb from './fb.service.js';

// The page list is shared/global (like the post pool); user_id is the admin
// creator (audit). Secrets (app_secret, app_client_token, access_token) are
// stored encrypted and NEVER returned to the browser.

function toSafe(r) {
  return {
    id: r.id,
    account_name: r.account_name,
    fb_page_id: r.fb_page_id,
    app_id: r.app_id,
    is_active: !!r.is_active,
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

// Internal only — full row with decrypted credentials (for posting / Graph calls).
// Never wire this to a client-facing response.
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
    is_active: !!r.is_active,
  };
}

function requireStr(value, label) {
  const s = String(value ?? '').trim();
  if (!s) throw ApiError.badRequest(`${label} is required`);
  return s;
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
  const result = await query(
    `INSERT INTO platform_accounts
       (user_id, platform_name, account_name, fb_page_id, app_id, app_secret, app_client_token, access_token, is_active)
     VALUES (?, 'facebook', ?, ?, ?, ?, ?, ?, 1)`,
    [
      actor.id ?? null,
      account_name,
      fb_page_id,
      data.app_id ? String(data.app_id).trim() : null,
      encrypt(data.app_secret),
      encrypt(data.app_client_token),
      encrypt(access_token),
    ],
  );
  return getById(result.insertId);
}

export async function update(id, data = {}) {
  await getById(id); // existence
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
  if (fields.length) {
    params.push(id);
    await query(`UPDATE platform_accounts SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  return getById(id);
}

export async function remove(id) {
  await getById(id); // 404 if already gone
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
