import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import * as activity from './activity.service.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEN = 2000;
const STATUSES = ['pending', 'ongoing', 'completed', 'cancelled'];

// Validate a calendar day. Stored as a plain DATE (no time / timezone), so the
// app keys notes by the same local YYYY-MM-DD string the calendar renders.
function normalizeDate(value) {
  const s = String(value ?? '');
  if (!DATE_RE.test(s)) throw ApiError.badRequest('a valid date (YYYY-MM-DD) is required');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('invalid date');
  return s;
}

function normalizeContent(value) {
  const c = String(value ?? '').trim();
  if (!c) throw ApiError.badRequest('note content is required');
  if (c.length > MAX_LEN) throw ApiError.badRequest(`note is too long (max ${MAX_LEN} characters)`);
  return c;
}

function normalizeStatus(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!STATUSES.includes(s)) throw ApiError.badRequest(`invalid status (one of: ${STATUSES.join(', ')})`);
  return s;
}

// Common projection — note_date formatted as a string so mysql2 can't shift the
// DATE across timezones.
const SELECT_COLS = `id, DATE_FORMAT(note_date, '%Y-%m-%d') AS note_date, content, status, user_id, user_name, created_at, updated_at`;

export async function getById(id) {
  const rows = await query(`SELECT ${SELECT_COLS} FROM content_notes WHERE id = ?`, [id]);
  if (!rows.length) throw ApiError.notFound('note not found');
  return rows[0];
}

// All notes planned for one calendar day, in the order they were added.
export async function listByDate(date) {
  const d = normalizeDate(date);
  return query(
    `SELECT ${SELECT_COLS} FROM content_notes WHERE note_date = ? ORDER BY created_at ASC, id ASC`,
    [d],
  );
}

// Per-day note counts for a month → { 'YYYY-MM-DD': n }, for the calendar badges.
export async function monthCounts(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1970 || y > 9999) throw ApiError.badRequest('invalid year');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw ApiError.badRequest('invalid month (1-12)');
  const rows = await query(
    `SELECT DATE_FORMAT(note_date, '%Y-%m-%d') AS d, COUNT(*) AS c
       FROM content_notes
      WHERE YEAR(note_date) = ? AND MONTH(note_date) = ?
      GROUP BY note_date`,
    [y, m],
  );
  const counts = {};
  for (const r of rows) counts[r.d] = Number(r.c);
  return counts;
}

// `actor` = { id, name } of the signed-in user (recorded as the author).
export async function create(actor = {}, { note_date, content, status } = {}) {
  const d = normalizeDate(note_date);
  const c = normalizeContent(content);
  const s = status == null || status === '' ? 'pending' : normalizeStatus(status);
  const result = await query(
    'INSERT INTO content_notes (note_date, content, status, user_id, user_name) VALUES (?, ?, ?, ?, ?)',
    [d, c, s, actor.id ?? null, actor.name ?? null],
  );
  const note = await getById(result.insertId);
  await activity.log({
    noteId: note.id,
    userId: actor.id,
    userName: actor.name,
    action: 'created',
    details: `${d} — ${c.slice(0, 100)}`,
  });
  return note;
}

// `actor` = { id, name } of the editor (logged to the activity trail).
export async function update(id, { content } = {}, actor = {}) {
  const existing = await getById(id); // existence check
  const c = normalizeContent(content);
  await query('UPDATE content_notes SET content = ? WHERE id = ?', [c, id]);
  await activity.log({
    noteId: Number(id),
    userId: actor.id,
    userName: actor.name,
    action: 'edited',
    details: `${existing.note_date} — ${c.slice(0, 100)}`,
  });
  return getById(id);
}

// Tag the note's status (pending/ongoing/completed/cancelled). Logged as a
// distinct 'tagged' action. No-op (and no log) when the status is unchanged.
export async function setStatus(id, { status } = {}, actor = {}) {
  const existing = await getById(id);
  const s = normalizeStatus(status);
  if (s === existing.status) return existing;
  await query('UPDATE content_notes SET status = ? WHERE id = ?', [s, id]);
  await activity.log({
    noteId: Number(id),
    userId: actor.id,
    userName: actor.name,
    action: 'tagged',
    details: `${existing.note_date} — status → ${s}`,
  });
  return getById(id);
}

// Move the note to a different calendar day (drag-and-drop onto another date).
// Logged as an 'edited' action noting the move. No-op when the day is unchanged.
export async function setDate(id, { note_date } = {}, actor = {}) {
  const existing = await getById(id);
  const d = normalizeDate(note_date);
  if (d === existing.note_date) return existing;
  await query('UPDATE content_notes SET note_date = ? WHERE id = ?', [d, id]);
  await activity.log({
    noteId: Number(id),
    userId: actor.id,
    userName: actor.name,
    action: 'edited',
    details: `moved ${existing.note_date} → ${d}`,
  });
  return getById(id);
}

// `actor` = { id, name } of the deleter (logged to the activity trail).
export async function remove(id, actor = {}) {
  const existing = await getById(id); // existence check (also gives details for the log)
  await query('DELETE FROM content_notes WHERE id = ?', [id]);
  await activity.log({
    noteId: Number(id), // no FK on note_id, so keep it as a type hint for the feed
    userId: actor.id,
    userName: actor.name,
    action: 'deleted',
    details: `${existing.note_date} — ${String(existing.content || '').slice(0, 100)}`,
  });
  return { id: Number(id), deleted: true };
}
