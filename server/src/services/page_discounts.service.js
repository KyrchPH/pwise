import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';

// Per-page discount rules (Shop → Discounts). Scoped per connected page like
// page_products. A rule has a value (fixed amount or percentage, with an optional
// money cap when percentage) and a scope deciding when it applies. `applies_to`
// decides whether it discounts the whole order or only the qualifying items, and
// `stackable` lets it combine on top of the best non-stackable rule. The actual cart
// math lives in the client engine (config/discounts.js); this service just stores +
// validates the rules.

const MAX_NAME = 255;
const MAX_DESC = 4000;
const MAX_CODE = 60;
const MAX_CATEGORY = 120;

const VALUE_TYPES = new Set(['fixed', 'percent']);
const SCOPES = new Set(['all', 'category', 'product', 'cart_item_count', 'product_qty', 'min_order_amount']);
const APPLIES_TO = new Set(['order', 'matching_items']);

function requireAccount(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('a valid page (accountId) is required');
  return id;
}

function clampText(value, max) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function toBool(value, dflt) {
  if (value === undefined || value === null || value === '') return dflt;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function posNumber(value, label, { allowZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
    throw ApiError.badRequest(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return n;
}

function posInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw ApiError.badRequest(`${label} must be a positive whole number`);
  return n;
}

// datetime-local ("YYYY-MM-DDTHH:MM") or ISO → "YYYY-MM-DD HH:MM:SS" (UTC). Stored
// verbatim (a string, so mysql2 doesn't tz-shift it); reads come back as a UTC Date.
function normalizeDateTime(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('invalid date');
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Prefer payload (snake or camel); fall back to the existing record (on update);
// then the default. Used so a partial PATCH (e.g. just toggling `active`) re-validates
// against the full, current rule.
function readField(payload, snake, camel, existing, key, dflt) {
  if (payload[snake] !== undefined) return payload[snake];
  if (payload[camel] !== undefined) return payload[camel];
  if (existing && existing[key] !== undefined && existing[key] !== null) return existing[key];
  return dflt;
}

// Build + validate the full set of column values from a payload (merged over the
// existing rule on update). Throws ApiError.badRequest on any invalid combination.
function validate(payload, existing) {
  const name = clampText(readField(payload, 'name', 'name', existing, 'name', ''), MAX_NAME);
  if (!name) throw ApiError.badRequest('a discount name is required');
  const description = clampText(readField(payload, 'description', 'description', existing, 'description', ''), MAX_DESC);
  const active = toBool(readField(payload, 'active', 'active', existing, 'active', true), true);

  const valueType = String(readField(payload, 'value_type', 'valueType', existing, 'valueType', '')).trim();
  if (!VALUE_TYPES.has(valueType)) throw ApiError.badRequest("value_type must be 'fixed' or 'percent'");
  const value = posNumber(readField(payload, 'value', 'value', existing, 'value', null), 'value');
  if (valueType === 'percent' && value > 100) throw ApiError.badRequest('percentage cannot exceed 100');

  let percentCap = null;
  if (valueType === 'percent') {
    const capRaw = readField(payload, 'percent_cap', 'percentCap', existing, 'percentCap', null);
    percentCap = capRaw == null || capRaw === '' ? null : posNumber(capRaw, 'percent cap');
  }

  const scope = String(readField(payload, 'scope', 'scope', existing, 'scope', '')).trim();
  if (!SCOPES.has(scope)) throw ApiError.badRequest('invalid discount scope');

  let targetCategory = null;
  let targetProductId = null;
  let thresholdQty = null;
  let minAmount = null;
  if (scope === 'category') {
    targetCategory = clampText(readField(payload, 'target_category', 'targetCategory', existing, 'targetCategory', ''), MAX_CATEGORY);
    if (!targetCategory) throw ApiError.badRequest('a target category is required for this scope');
  }
  if (scope === 'product' || scope === 'product_qty') {
    targetProductId = posInt(readField(payload, 'target_product_id', 'targetProductId', existing, 'targetProductId', null), 'target product');
  }
  if (scope === 'cart_item_count' || scope === 'product_qty') {
    thresholdQty = posInt(readField(payload, 'threshold_qty', 'thresholdQty', existing, 'thresholdQty', null), 'threshold quantity');
  }
  if (scope === 'min_order_amount') {
    minAmount = posNumber(readField(payload, 'min_amount', 'minAmount', existing, 'minAmount', null), 'minimum order amount');
  }

  // Order-level scopes can only discount the whole order; only item-targeting scopes
  // may discount just the matching items.
  let appliesTo = String(readField(payload, 'applies_to', 'appliesTo', existing, 'appliesTo', 'order')).trim();
  if (!APPLIES_TO.has(appliesTo)) appliesTo = 'order';
  if (scope === 'all' || scope === 'min_order_amount' || scope === 'cart_item_count') appliesTo = 'order';

  const stackable = toBool(readField(payload, 'stackable', 'stackable', existing, 'stackable', false), false);
  const priorityRaw = Number(readField(payload, 'priority', 'priority', existing, 'priority', 0));
  const priority = Number.isFinite(priorityRaw) ? Math.trunc(priorityRaw) : 0;

  const startsAt = normalizeDateTime(readField(payload, 'starts_at', 'startsAt', existing, 'startsAt', null));
  const endsAt = normalizeDateTime(readField(payload, 'ends_at', 'endsAt', existing, 'endsAt', null));
  if (startsAt && endsAt && endsAt < startsAt) throw ApiError.badRequest('the end date must be after the start date');

  const code = clampText(readField(payload, 'code', 'code', existing, 'code', ''), MAX_CODE);

  return {
    name, description, active, valueType, value, percentCap, scope,
    targetCategory, targetProductId, thresholdQty, minAmount, appliesTo,
    stackable, priority, startsAt, endsAt, code,
  };
}

function toSafe(r) {
  return {
    id: Number(r.id),
    accountId: r.account_id,
    name: r.name,
    description: r.description || '',
    active: !!r.active,
    valueType: r.value_type,
    value: r.value == null ? 0 : Number(r.value),
    percentCap: r.percent_cap == null ? null : Number(r.percent_cap),
    scope: r.scope,
    targetCategory: r.target_category || null,
    targetProductId: r.target_product_id ?? null,
    thresholdQty: r.threshold_qty ?? null,
    minAmount: r.min_amount == null ? null : Number(r.min_amount),
    appliesTo: r.applies_to,
    stackable: !!r.stackable,
    priority: r.priority ?? 0,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    code: r.code || null,
    createdBy: r.created_by ?? null,
    updatedBy: r.updated_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getById(id) {
  const rows = await query('SELECT * FROM page_discounts WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('discount not found');
  return toSafe(rows[0]);
}

// Discounts for one page — active first, then by priority (highest first).
export async function list(accountId) {
  const acc = requireAccount(accountId);
  const rows = await query(
    'SELECT * FROM page_discounts WHERE account_id = ? ORDER BY active DESC, priority DESC, id DESC',
    [acc],
  );
  return rows.map(toSafe);
}

// `actor` = { id } of the signed-in user (recorded as creator + editor).
export async function create(actor = {}, payload = {}) {
  const acc = requireAccount(payload.account_id ?? payload.accountId);
  const v = validate(payload, null);
  const result = await query(
    `INSERT INTO page_discounts
       (account_id, name, description, active, value_type, value, percent_cap, scope,
        target_category, target_product_id, threshold_qty, min_amount, applies_to,
        stackable, priority, starts_at, ends_at, code, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      acc, v.name, v.description, v.active ? 1 : 0, v.valueType, v.value, v.percentCap, v.scope,
      v.targetCategory, v.targetProductId, v.thresholdQty, v.minAmount, v.appliesTo,
      v.stackable ? 1 : 0, v.priority, v.startsAt, v.endsAt, v.code, actor.id ?? null, actor.id ?? null,
    ],
  );
  return getById(result.insertId);
}

export async function update(id, actor = {}, payload = {}) {
  const existing = await getById(id); // existence check + merge base
  const v = validate(payload, existing);
  await query(
    `UPDATE page_discounts SET
       name = ?, description = ?, active = ?, value_type = ?, value = ?, percent_cap = ?,
       scope = ?, target_category = ?, target_product_id = ?, threshold_qty = ?, min_amount = ?,
       applies_to = ?, stackable = ?, priority = ?, starts_at = ?, ends_at = ?, code = ?, updated_by = ?
     WHERE id = ?`,
    [
      v.name, v.description, v.active ? 1 : 0, v.valueType, v.value, v.percentCap, v.scope,
      v.targetCategory, v.targetProductId, v.thresholdQty, v.minAmount, v.appliesTo,
      v.stackable ? 1 : 0, v.priority, v.startsAt, v.endsAt, v.code, actor.id ?? null, id,
    ],
  );
  return getById(id);
}

export async function remove(id) {
  await getById(id); // existence check
  await query('DELETE FROM page_discounts WHERE id = ?', [id]);
  return { id: Number(id), deleted: true };
}
