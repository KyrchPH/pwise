import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import * as activity from './activity.service.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
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

// An optional per-note colour. Empty / null clears it (falls back to the theme
// default); otherwise it must be a hex string (#RGB, #RGBA, #RRGGBB, #RRGGBBAA).
function normalizeColor(value) {
  if (value == null || value === '') return null;
  const c = String(value).trim();
  if (!COLOR_RE.test(c)) throw ApiError.badRequest('invalid colour (expected a hex value like #a1b2c3)');
  return c.toLowerCase();
}

// The connected page a note belongs to (drives its calendar logo). Empty / null =
// untagged; otherwise it must reference a real platform_accounts row.
async function normalizePageId(value) {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('invalid page_id');
  const rows = await query('SELECT id FROM platform_accounts WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.badRequest('page not found');
  return id;
}

// Common projection — note_date formatted as a string so mysql2 can't shift the
// DATE across timezones. LEFT JOINs the owning page so each note carries the name /
// fb_page_id needed to render its logo on the (page-independent) calendar.
const SELECT_COLS = `cn.id, DATE_FORMAT(cn.note_date, '%Y-%m-%d') AS note_date, cn.content, cn.status, cn.position,
  cn.text_color, cn.note_color, cn.page_id, a.account_name AS page_name, a.fb_page_id AS page_fb_id,
  cn.user_id, cn.user_name, cn.created_at, cn.updated_at`;
const NOTE_FROM = 'FROM content_notes cn LEFT JOIN platform_accounts a ON a.id = cn.page_id';

export async function getById(id) {
  const rows = await query(`SELECT ${SELECT_COLS} ${NOTE_FROM} WHERE cn.id = ?`, [id]);
  if (!rows.length) throw ApiError.notFound('note not found');
  return rows[0];
}

// All notes planned for one calendar day, in the user's chosen order (position),
// then add order as a stable tie-breaker.
export async function listByDate(date) {
  const d = normalizeDate(date);
  return query(
    `SELECT ${SELECT_COLS} ${NOTE_FROM} WHERE cn.note_date = ? ORDER BY cn.position ASC, cn.created_at ASC, cn.id ASC`,
    [d],
  );
}

// Per-day note summary for a month → { 'YYYY-MM-DD': { count, notes } }, for the
// calendar chips. `notes` is the first few notes that day ({ text (truncated), status })
// so each renders as its own chip; `count` is the day's full total (drives "+N more").
export async function monthCounts(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1970 || y > 9999) throw ApiError.badRequest('invalid year');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw ApiError.badRequest('invalid month (1-12)');
  const CHIPS_PER_DAY = 3;
  const rows = await query(
    `SELECT DATE_FORMAT(cn.note_date, '%Y-%m-%d') AS d, LEFT(cn.content, 80) AS text, cn.status,
            cn.note_color, cn.text_color, cn.page_id, a.account_name AS page_name, a.fb_page_id AS page_fb_id
       FROM content_notes cn
       LEFT JOIN platform_accounts a ON a.id = cn.page_id
      WHERE YEAR(cn.note_date) = ? AND MONTH(cn.note_date) = ?
      ORDER BY cn.note_date ASC, cn.position ASC, cn.created_at ASC, cn.id ASC`,
    [y, m],
  );
  const counts = {};
  for (const r of rows) {
    const e = counts[r.d] || (counts[r.d] = { count: 0, notes: [] });
    e.count += 1;
    if (e.notes.length < CHIPS_PER_DAY) {
      e.notes.push({
        text: r.text,
        status: r.status,
        color: r.note_color,
        text_color: r.text_color,
        page_id: r.page_id,
        page_name: r.page_name,
        page_fb_id: r.page_fb_id,
      });
    }
  }
  return counts;
}

// The next free position (0-based) at the end of a day's list.
async function nextPosition(date) {
  const [row] = await query('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM content_notes WHERE note_date = ?', [date]);
  return row?.next ?? 0;
}

// `actor` = { id, name } of the signed-in user (recorded as the author). `page_id`
// tags the owning page (defaults to the active page on the client) — optional.
export async function create(actor = {}, { note_date, content, status, page_id } = {}) {
  const d = normalizeDate(note_date);
  const c = normalizeContent(content);
  const s = status == null || status === '' ? 'pending' : normalizeStatus(status);
  const pageId = await normalizePageId(page_id);
  const position = await nextPosition(d); // new notes land at the bottom of the day
  const result = await query(
    'INSERT INTO content_notes (note_date, content, status, position, page_id, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [d, c, s, position, pageId, actor.id ?? null, actor.name ?? null],
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
  const position = await nextPosition(d); // land at the bottom of the target day
  await query('UPDATE content_notes SET note_date = ?, position = ? WHERE id = ?', [d, position, id]);
  await activity.log({
    noteId: Number(id),
    userId: actor.id,
    userName: actor.name,
    action: 'edited',
    details: `moved ${existing.note_date} → ${d}`,
  });
  return getById(id);
}

// Re-tag the note's owning page (the page-picker override). null clears the tag.
// Logged as an 'edited' action. No-op when the page is unchanged.
export async function setPage(id, { page_id } = {}, actor = {}) {
  const existing = await getById(id);
  const pageId = await normalizePageId(page_id);
  if (pageId === existing.page_id) return existing;
  await query('UPDATE content_notes SET page_id = ? WHERE id = ?', [pageId, id]);
  await activity.log({
    noteId: Number(id),
    userId: actor.id,
    userName: actor.name,
    action: 'edited',
    details: `${existing.note_date} — page → ${pageId ?? 'none'}`,
  });
  return getById(id);
}

// Re-rank a day's notes to match `ids` (the note ids in their new top-to-bottom
// order). Only notes actually on that day are touched; unknown / foreign ids are
// ignored. Returns the day's notes in the new order. Cosmetic — not logged.
export async function reorder(date, ids, _actor = {}) {
  const d = normalizeDate(date);
  if (!Array.isArray(ids)) throw ApiError.badRequest('ids must be an array of note ids');
  const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  // Bulk single-statement re-rank: a CASE maps each id to its new position, scoped
  // to the day so a stale id from another day can never be moved here.
  if (numericIds.length) {
    const cases = numericIds.map((id, i) => `WHEN ${id} THEN ${i}`).join(' ');
    const placeholders = numericIds.map(() => '?').join(', ');
    await query(
      `UPDATE content_notes SET position = CASE id ${cases} ELSE position END
        WHERE note_date = ? AND id IN (${placeholders})`,
      [d, ...numericIds],
    );
  }
  return listByDate(d);
}

// Set (or clear) a note's text / background colour overrides. Either field may be
// omitted to leave it unchanged, or set to null/'' to reset to the theme default.
// Cosmetic — not logged to the activity trail.
export async function setColor(id, { text_color, note_color } = {}, _actor = {}) {
  const existing = await getById(id); // existence check
  const sets = [];
  const params = [];
  if (text_color !== undefined) {
    sets.push('text_color = ?');
    params.push(normalizeColor(text_color));
  }
  if (note_color !== undefined) {
    sets.push('note_color = ?');
    params.push(normalizeColor(note_color));
  }
  if (!sets.length) return existing;
  params.push(id);
  await query(`UPDATE content_notes SET ${sets.join(', ')} WHERE id = ?`, params);
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
