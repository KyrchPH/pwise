import api from './api.js';

// Notes planned for one calendar day (YYYY-MM-DD). Returns an array, in add order.
export async function listByDate(date) {
  const { data } = await api.get('/content-notes', { params: { date } });
  return data.data.notes;
}

// Per-day note summary for a month → { 'YYYY-MM-DD': { count, notes } }, where
// `notes` is the first few [{ text, status }] for that day. `month` is 1-12.
export async function monthCounts(year, month) {
  const { data } = await api.get('/content-notes/month', { params: { year, month } });
  return data.data.counts;
}

export async function create(payload) {
  const { data } = await api.post('/content-notes', payload);
  return data.data.note;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/content-notes/${id}`, payload);
  return data.data.note;
}

// Tag a note's status: 'pending' | 'ongoing' | 'completed' | 'cancelled'.
export async function setStatus(id, status) {
  const { data } = await api.patch(`/content-notes/${id}/status`, { status });
  return data.data.note;
}

// Move a note to another calendar day (YYYY-MM-DD).
export async function setDate(id, note_date) {
  const { data } = await api.patch(`/content-notes/${id}/date`, { note_date });
  return data.data.note;
}

// Re-tag a note's owning page (the page-picker override). null/'' clears the tag.
export async function setPage(id, page_id) {
  const { data } = await api.patch(`/content-notes/${id}/page`, { page_id });
  return data.data.note;
}

// Persist a day's note order. `ids` is the note ids top-to-bottom. Returns the
// day's notes in the saved order.
export async function reorder(date, ids) {
  const { data } = await api.patch('/content-notes/reorder', { date, ids });
  return data.data.notes;
}

// Set (or clear with null/'') a note's text / background colour. Omit a field to
// leave it unchanged.
export async function setColor(id, colors) {
  const { data } = await api.patch(`/content-notes/${id}/color`, colors);
  return data.data.note;
}

export async function remove(id) {
  const { data } = await api.delete(`/content-notes/${id}`);
  return data.data;
}
