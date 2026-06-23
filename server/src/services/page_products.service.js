import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl } from './s3.service.js';

// Per-page product catalog. Products belong to a connected page (account_id) and are
// shared like the rest of the app's data. The photo is stored as a STABLE S3 key
// (resolved from the Vault item picked in the UI); the API hands back a freshly
// presigned `photo_url` on read, since S3/Vault download URLs expire.

const MAX_NAME = 255;
const MAX_CATEGORY = 120;
const MAX_DESC = 4000;
const MAX_TAGS = 20;
const PHOTO_URL_TTL = 7 * 24 * 60 * 60; // 7 days — robust for display + attach-and-send

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeName(value) {
  const s = String(value ?? '').trim();
  if (!s) throw ApiError.badRequest('product name is required');
  if (s.length > MAX_NAME) throw ApiError.badRequest(`name is too long (max ${MAX_NAME} characters)`);
  return s;
}

function normalizePrice(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw ApiError.badRequest('base price must be a non-negative number');
  return n;
}

function normalizeTags(value) {
  let arr = value;
  if (typeof value === 'string') arr = value.split(',');
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((t) => String(t).trim()).filter(Boolean))].slice(0, MAX_TAGS);
}

function clampText(value, max) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}

// Resolve a picked Vault file id to its stable S3 key — the durable photo reference.
async function resolvePhotoKey(vaultItemId) {
  if (vaultItemId == null || vaultItemId === '') return null;
  const rows = await query("SELECT s3_key FROM vault_items WHERE id = ? AND type = 'file'", [vaultItemId]);
  return rows.length && rows[0].s3_key ? rows[0].s3_key : null;
}

async function rowToProduct(row) {
  let photoUrl = '';
  if (row.photo_key) {
    try {
      photoUrl = await createDownloadUrl(row.photo_key, PHOTO_URL_TTL);
    } catch {
      photoUrl = '';
    }
  }
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    basePrice: row.base_price == null ? null : Number(row.base_price),
    description: row.description || '',
    category: row.category || '',
    tags: parseJson(row.tags, []) || [],
    photoUrl,
    hasPhoto: !!row.photo_key,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getById(id) {
  const rows = await query('SELECT * FROM page_products WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('product not found');
  return rowToProduct(rows[0]);
}

// Products for one page (newest first). photo_url is presigned per row.
export async function list(accountId) {
  const acct = Number(accountId);
  if (!Number.isInteger(acct)) throw ApiError.badRequest('a valid accountId is required');
  const rows = await query(
    'SELECT * FROM page_products WHERE account_id = ? ORDER BY created_at DESC, id DESC',
    [acct],
  );
  return Promise.all(rows.map(rowToProduct));
}

// `actor` = { id } of the signed-in user (recorded as creator + editor).
export async function create(actor = {}, payload = {}) {
  const accountId = Number(payload.account_id ?? payload.accountId);
  if (!Number.isInteger(accountId)) throw ApiError.badRequest('a valid account_id is required');
  const name = normalizeName(payload.name);
  const basePrice = normalizePrice(payload.base_price ?? payload.basePrice);
  const description = clampText(payload.description, MAX_DESC);
  const category = clampText(payload.category, MAX_CATEGORY);
  const tags = normalizeTags(payload.tags);
  const photoKey = await resolvePhotoKey(payload.vault_item_id ?? payload.vaultItemId);

  const result = await query(
    `INSERT INTO page_products
       (account_id, name, base_price, description, category, tags, photo_key, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [accountId, name, basePrice, description, category, JSON.stringify(tags), photoKey, actor.id ?? null, actor.id ?? null],
  );
  return getById(result.insertId);
}

export async function update(id, actor = {}, payload = {}) {
  await getById(id); // existence check
  const sets = [];
  const params = [];
  if (payload.name !== undefined) {
    sets.push('name = ?');
    params.push(normalizeName(payload.name));
  }
  if (payload.base_price !== undefined || payload.basePrice !== undefined) {
    sets.push('base_price = ?');
    params.push(normalizePrice(payload.base_price ?? payload.basePrice));
  }
  if (payload.description !== undefined) {
    sets.push('description = ?');
    params.push(clampText(payload.description, MAX_DESC));
  }
  if (payload.category !== undefined) {
    sets.push('category = ?');
    params.push(clampText(payload.category, MAX_CATEGORY));
  }
  if (payload.tags !== undefined) {
    sets.push('tags = ?');
    params.push(JSON.stringify(normalizeTags(payload.tags)));
  }
  // Photo: a newly picked Vault item resolves to a new key; an explicit remove clears
  // it; omitting both keeps the current photo.
  if (payload.vault_item_id !== undefined || payload.vaultItemId !== undefined) {
    sets.push('photo_key = ?');
    params.push(await resolvePhotoKey(payload.vault_item_id ?? payload.vaultItemId));
  } else if (payload.photo_remove === true || payload.photoRemove === true) {
    sets.push('photo_key = ?');
    params.push(null);
  }
  sets.push('updated_by = ?');
  params.push(actor.id ?? null);
  params.push(id);
  await query(`UPDATE page_products SET ${sets.join(', ')} WHERE id = ?`, params);
  return getById(id);
}

export async function remove(id) {
  await getById(id); // existence check
  await query('DELETE FROM page_products WHERE id = ?', [id]);
  return { id: Number(id), deleted: true };
}
