import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';

const MAX_LEN = 20000;
const COLS = 'id, name, config, user_id, created_at, updated_at';

function normalizeName(value) {
  const n = String(value ?? '').trim();
  if (!n) throw ApiError.badRequest('template name is required');
  if (n.length > 255) throw ApiError.badRequest('name is too long (max 255 characters)');
  return n;
}

// Validate the config is a JSON object; return it pretty-printed (canonical).
function normalizeConfig(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw ApiError.badRequest('template JSON is required');
  if (raw.length > MAX_LEN) throw ApiError.badRequest(`template JSON is too long (max ${MAX_LEN} characters)`);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw ApiError.badRequest('template JSON is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ApiError.badRequest('template JSON must be a JSON object');
  }
  return JSON.stringify(parsed, null, 2);
}

export async function list() {
  return query(`SELECT ${COLS} FROM creatomate_templates ORDER BY created_at DESC`);
}

export async function getById(id) {
  const rows = await query(`SELECT ${COLS} FROM creatomate_templates WHERE id = ?`, [id]);
  if (!rows.length) throw ApiError.notFound('template not found');
  return rows[0];
}

// `actor` = { id, name } of the signed-in user (recorded as the creator).
export async function create(actor = {}, { name, config } = {}) {
  const n = normalizeName(name);
  const c = normalizeConfig(config);
  const result = await query('INSERT INTO creatomate_templates (name, config, user_id) VALUES (?, ?, ?)', [
    n,
    c,
    actor.id ?? null,
  ]);
  return getById(result.insertId);
}

export async function update(id, { name, config } = {}) {
  await getById(id); // existence check
  const fields = [];
  const params = [];
  if (name !== undefined) {
    fields.push('name = ?');
    params.push(normalizeName(name));
  }
  if (config !== undefined) {
    fields.push('config = ?');
    params.push(normalizeConfig(config));
  }
  if (fields.length) {
    params.push(id);
    await query(`UPDATE creatomate_templates SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  return getById(id);
}

export async function remove(id) {
  const result = await query('DELETE FROM creatomate_templates WHERE id = ?', [id]);
  if (!result.affectedRows) throw ApiError.notFound('template not found');
  return { id: Number(id), deleted: true };
}
