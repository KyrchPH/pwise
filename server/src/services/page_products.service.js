import { query, getConnection } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl } from './s3.service.js';

// Per-page product catalog. Products belong to a connected page (account_id) and are
// shared like the rest of the app's data. The photo is stored as a STABLE S3 key
// (resolved from the Vault item picked in the UI); the API hands back a freshly
// presigned `photo_url` on read, since S3/Vault download URLs expire.
//
// Variants (option matrix): a product may define option axes in `options`
// (e.g. Size, Scent); the app generates one row per combination in
// page_product_variants, each with its own price + photo. A product with no options
// is "simple" and uses base_price. The client owns combination generation and sends
// the full desired variant set on save; the server validates + replaces it atomically.

const MAX_NAME = 255;
const MAX_CATEGORY = 120;
const MAX_DESC = 4000;
const MAX_TAGS = 20;
const PHOTO_URL_TTL = 7 * 24 * 60 * 60; // 7 days — robust for display + attach-and-send

// Variant/option guard rails (keep the matrix sane).
const MAX_AXES = 4;
const MAX_AXIS_NAME = 60;
const MAX_OPTION_VALUE = 60;
const MAX_VALUES_PER_AXIS = 50;
const MAX_COMBINATIONS = 100;

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
  if (!Number.isFinite(n) || n < 0) throw ApiError.badRequest('price must be a non-negative number');
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

// Normalize the option axes: [{name, values:[...]}]. Drops blank/duplicate names and
// values; caps axes, values-per-axis, and the total combination count so the matrix
// can't blow up. Returns [] for a simple (no-variant) product.
function normalizeOptions(value) {
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seenNames = new Set();
  for (const axis of arr) {
    if (!axis || typeof axis !== 'object') continue;
    const name = String(axis.name ?? '').trim().slice(0, MAX_AXIS_NAME);
    if (!name) continue;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) continue;
    let values = axis.values;
    if (typeof values === 'string') values = values.split(',');
    if (!Array.isArray(values)) continue;
    const vals = [];
    const seenVals = new Set();
    for (const v of values) {
      const sv = String(v ?? '').trim().slice(0, MAX_OPTION_VALUE);
      if (!sv) continue;
      const vk = sv.toLowerCase();
      if (seenVals.has(vk)) continue;
      seenVals.add(vk);
      vals.push(sv);
      if (vals.length >= MAX_VALUES_PER_AXIS) break;
    }
    if (!vals.length) continue;
    seenNames.add(nameKey);
    out.push({ name, values: vals });
    if (out.length >= MAX_AXES) break;
  }
  const combos = out.reduce((n, axis) => n * axis.values.length, 1);
  if (out.length && combos > MAX_COMBINATIONS) {
    throw ApiError.badRequest(`too many variant combinations (${combos}); the max is ${MAX_COMBINATIONS}`);
  }
  return out;
}

// Canonical identity of a combination, in axis order: "Size=1L|Scent=Lemon".
function comboKeyOf(optionValues, options) {
  return options.map((axis) => `${axis.name}=${optionValues[axis.name]}`).join('|');
}

// Validate + canonicalize the variants the client sends against the (already
// normalized) options. Each variant must name a valid value for EVERY axis; invalid
// ones are dropped and duplicates collapse by combo_key (last wins). Photo intent is
// preserved as { vaultItemId } (new pick) / { remove: true } / { keep: true }.
function normalizeVariants(value, options) {
  if (!options.length) return [];
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const byKey = new Map();
  let order = 0;
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue;
    const rawValues = v.option_values ?? v.optionValues ?? {};
    const optionValues = {};
    let valid = true;
    for (const axis of options) {
      const val = String(rawValues[axis.name] ?? '').trim();
      if (!axis.values.includes(val)) {
        valid = false;
        break;
      }
      optionValues[axis.name] = val;
    }
    if (!valid) continue;
    const comboKey = comboKeyOf(optionValues, options);
    let photo;
    if (v.vault_item_id !== undefined || v.vaultItemId !== undefined) {
      photo = { vaultItemId: v.vault_item_id ?? v.vaultItemId };
    } else if (v.photo_remove === true || v.photoRemove === true) {
      photo = { remove: true };
    } else {
      photo = { keep: true };
    }
    byKey.set(comboKey, {
      comboKey,
      optionValues,
      price: normalizePrice(v.price),
      active: v.active === undefined ? true : !!v.active,
      sortOrder: order,
      photo,
    });
    order += 1;
  }
  return [...byKey.values()];
}

// Resolve a picked Vault file id to its stable S3 key — the durable photo reference.
async function resolvePhotoKey(vaultItemId) {
  if (vaultItemId == null || vaultItemId === '') return null;
  const rows = await query("SELECT s3_key FROM vault_items WHERE id = ? AND type = 'file'", [vaultItemId]);
  return rows.length && rows[0].s3_key ? rows[0].s3_key : null;
}

async function variantRowToVariant(row) {
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
    comboKey: row.combo_key,
    optionValues: parseJson(row.option_values, {}) || {},
    price: row.price == null ? null : Number(row.price),
    photoUrl,
    hasPhoto: !!row.photo_key,
    active: !!row.active,
    sortOrder: row.sort_order ?? 0,
  };
}

async function rowToProduct(row, variantRows = []) {
  let photoUrl = '';
  if (row.photo_key) {
    try {
      photoUrl = await createDownloadUrl(row.photo_key, PHOTO_URL_TTL);
    } catch {
      photoUrl = '';
    }
  }
  const variants = await Promise.all(variantRows.map(variantRowToVariant));
  const livePrices = variants.filter((v) => v.active && v.price != null).map((v) => v.price);
  const priceFrom = livePrices.length ? Math.min(...livePrices) : null;
  const priceTo = livePrices.length ? Math.max(...livePrices) : null;
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    basePrice: row.base_price == null ? null : Number(row.base_price),
    description: row.description || '',
    category: row.category || '',
    tags: parseJson(row.tags, []) || [],
    options: parseJson(row.options, []) || [],
    variants,
    priceFrom,
    priceTo,
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
  const variantRows = await query(
    'SELECT * FROM page_product_variants WHERE product_id = ? ORDER BY sort_order, id',
    [id],
  );
  return rowToProduct(rows[0], variantRows);
}

// Products for one page (newest first). photo_url + each variant photo are presigned.
export async function list(accountId) {
  const acct = Number(accountId);
  if (!Number.isInteger(acct)) throw ApiError.badRequest('a valid accountId is required');
  const rows = await query(
    'SELECT * FROM page_products WHERE account_id = ? ORDER BY created_at DESC, id DESC',
    [acct],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const variantRows = await query(
    `SELECT * FROM page_product_variants WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order, id`,
    ids,
  );
  const byProduct = new Map();
  for (const vr of variantRows) {
    if (!byProduct.has(vr.product_id)) byProduct.set(vr.product_id, []);
    byProduct.get(vr.product_id).push(vr);
  }
  return Promise.all(rows.map((r) => rowToProduct(r, byProduct.get(r.id) || [])));
}

// Replace a product's variant rows with `desired` inside the given connection. On
// update, existing combos' photos are carried forward unless the client picked a new
// photo / asked to remove it (so a "keep" variant retains its photo across the
// delete+reinsert). Variant ids are not persisted anywhere else, so replace-all is safe.
async function writeVariants(conn, productId, desired, isUpdate) {
  let existing = new Map();
  if (isUpdate) {
    const [rows] = await conn.query('SELECT combo_key, photo_key FROM page_product_variants WHERE product_id = ?', [productId]);
    existing = new Map(rows.map((r) => [r.combo_key, r.photo_key]));
    await conn.query('DELETE FROM page_product_variants WHERE product_id = ?', [productId]);
  }
  for (const v of desired) {
    let photoKey = null;
    if (v.photo.vaultItemId != null && v.photo.vaultItemId !== '') {
      photoKey = await resolvePhotoKey(v.photo.vaultItemId);
    } else if (v.photo.keep) {
      photoKey = existing.get(v.comboKey) ?? null;
    } // remove → null
    await conn.query(
      `INSERT INTO page_product_variants
         (product_id, combo_key, option_values, price, photo_key, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, v.comboKey, JSON.stringify(v.optionValues), v.price, photoKey, v.active ? 1 : 0, v.sortOrder],
    );
  }
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
  const options = normalizeOptions(payload.options);
  const desired = normalizeVariants(payload.variants, options);
  const photoKey = await resolvePhotoKey(payload.vault_item_id ?? payload.vaultItemId);

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO page_products
         (account_id, name, base_price, description, category, tags, options, photo_key, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        name,
        basePrice,
        description,
        category,
        JSON.stringify(tags),
        options.length ? JSON.stringify(options) : null,
        photoKey,
        actor.id ?? null,
        actor.id ?? null,
      ],
    );
    await writeVariants(conn, result.insertId, desired, false);
    await conn.commit();
    return getById(result.insertId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
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

  // Options + variants travel together from the form. When options are provided we
  // rewrite both the `options` column and the whole variant set (empty options ⇒ the
  // product becomes simple and its variants are cleared).
  const optionsProvided = payload.options !== undefined;
  let options = [];
  let desired = [];
  if (optionsProvided) {
    options = normalizeOptions(payload.options);
    desired = normalizeVariants(payload.variants, options);
    sets.push('options = ?');
    params.push(options.length ? JSON.stringify(options) : null);
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

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE page_products SET ${sets.join(', ')} WHERE id = ?`, params);
    if (optionsProvided) await writeVariants(conn, Number(id), desired, true);
    await conn.commit();
    return getById(id);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function remove(id) {
  await getById(id); // existence check
  await query('DELETE FROM page_products WHERE id = ?', [id]); // variants cascade
  return { id: Number(id), deleted: true };
}
