import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';

// Per-page message templates (reusable canned replies). Each page gets its own set;
// on first access a page is seeded from DEFAULT_TEMPLATES, then it's fully editable
// from the Messaging → Templates section. Everything here is scoped by account_id —
// a template can only be read/edited/deleted in the context of the page that owns it.

// Seed set — copied from the original built-in list. Used only to populate a page the
// first time its templates are requested; after that the DB is the source of truth.
export const DEFAULT_TEMPLATES = [
  { title: 'Friendly greeting', body: 'Hi! Thanks for reaching out to Wise Cleaner Shop 😊 How can we help you today?', tags: ['greeting', 'welcome', 'hello'] },
  { title: 'Pricing — sofa cleaning', body: 'Sofa deep cleaning starts at ₱1,200 for a 3-seater. The final quote depends on the size, fabric, and stain level. Could you share a photo and your sofa details?', tags: ['pricing', 'sofa', 'quote', 'estimate'] },
  { title: 'Same-day availability', body: 'Good news — we may have a same-day slot open! Please share your area and preferred time so I can confirm availability for you.', tags: ['availability', 'same-day', 'schedule', 'booking'] },
  { title: 'Booking confirmation', body: 'Your booking is confirmed ✅ Our team will arrive within the scheduled window, and you’ll get a reminder a day before. Thank you for choosing us!', tags: ['booking', 'confirmation', 'schedule'] },
  { title: 'Reschedule request', body: 'No problem at all — we can move your appointment. What date and time would work best for you?', tags: ['reschedule', 'booking', 'schedule'] },
  { title: 'Deposit request', body: 'To lock in your slot we ask for a 50% deposit. I can send the GCash/bank details here — would you like to proceed?', tags: ['deposit', 'payment', 'gcash'] },
  { title: 'Pet & baby-safe products', body: 'Yes! Our solutions are fabric-safe, and we can note a fragrance-free, pet- and baby-safe preference on your booking.', tags: ['safety', 'products', 'pets', 'baby', 'allergy'] },
  { title: 'Post-service follow-up', body: 'Hi! We hope you’re happy with the clean ✨ If anything needs a quick touch-up, just let us know. A short review would mean a lot if you have a moment!', tags: ['follow-up', 'review', 'post-service'] },
  { title: 'Arrival window', body: 'Our team will arrive within the confirmed service window. We will message you once they are on the way.', tags: ['arrival', 'schedule', 'booking'] },
  { title: 'Request address', body: 'Please send the full service address, building name, unit number, and any parking or security instructions so we can prepare the team.', tags: ['address', 'booking', 'access'] },
  { title: 'Request photos', body: 'Could you send clear photos of the item or area to be cleaned? This helps us give a more accurate quote and prepare the right materials.', tags: ['photo', 'quote', 'estimate'] },
  { title: 'Payment received', body: 'Payment received. Thank you! Your slot is now secured, and we will keep you updated before the service date.', tags: ['payment', 'deposit', 'confirmation'] },
  { title: 'Invoice details needed', body: 'For the official receipt or invoice, please send the company name, TIN, billing address, and email where we should send the document.', tags: ['invoice', 'receipt', 'billing'] },
  { title: 'Service area check', body: 'May I confirm your city or barangay? I will check if your address is covered by our available team routes.', tags: ['area', 'coverage', 'location'] },
  { title: 'Before service prep', body: 'Before the team arrives, please clear small items from the work area and keep pets or children away from the cleaning zone during service.', tags: ['prep', 'instructions', 'service'] },
  { title: 'Team delay notice', body: 'Quick update: our team is running slightly behind schedule due to traffic. We are tracking their arrival and will update you again shortly.', tags: ['delay', 'arrival', 'operations'] },
  { title: 'Review link resend', body: 'Thank you for choosing Wise Cleaner Shop. Here is the review link again. We would appreciate your feedback when you have a moment.', tags: ['review', 'follow-up', 'post-service'] },
  { title: 'Unavailable slot', body: 'That slot is already taken, but I can offer the nearest available options. Would morning, afternoon, or evening work best for you?', tags: ['availability', 'schedule', 'booking'] },
  { title: 'Quote follow-up', body: 'Just following up on the quote we sent. Would you like us to reserve a tentative slot while you decide?', tags: ['quote', 'follow-up', 'lead'] },
  { title: 'Recurring cleaning', body: 'We can set up a recurring schedule weekly, biweekly, or monthly. Tell us your preferred frequency and day so we can check team availability.', tags: ['recurring', 'schedule', 'vip'] },
];

function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Accepts an array or a comma-separated string; trims, lowercases, de-dupes, caps at 12.
function normalizeTags(tags) {
  let arr = tags;
  if (typeof tags === 'string') arr = tags.split(',');
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const t of arr) {
    const clean = String(t).trim().toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= 12) break;
  }
  return out;
}

function toSafe(r) {
  return { id: Number(r.id), title: r.title, body: r.body, tags: parseTags(r.tags) };
}

function requireAccount(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('a valid page (accountId) is required');
  return id;
}

async function seedDefaults(accountId) {
  for (let i = 0; i < DEFAULT_TEMPLATES.length; i += 1) {
    const t = DEFAULT_TEMPLATES[i];
    await query('INSERT INTO message_templates (account_id, title, body, tags, sort_order) VALUES (?, ?, ?, ?, ?)', [
      accountId,
      t.title,
      t.body,
      JSON.stringify(t.tags || []),
      i,
    ]);
  }
}

// List a page's templates, seeding the defaults the first time the page has none.
export async function list(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const sql = 'SELECT * FROM message_templates WHERE account_id = ? ORDER BY sort_order ASC, id ASC';
  let rows = await query(sql, [id]);
  if (!rows.length) {
    await seedDefaults(id);
    rows = await query(sql, [id]);
  }
  return rows.map(toSafe);
}

async function nextSortOrder(accountId) {
  const rows = await query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM message_templates WHERE account_id = ?', [accountId]);
  return rows[0]?.next ?? 0;
}

export async function create(accountId, data = {}) {
  const id = requireAccount(accountId);
  const title = String(data.title ?? '').trim();
  const body = String(data.body ?? '').trim();
  if (!title) throw ApiError.badRequest('a template title is required');
  if (!body) throw ApiError.badRequest('a template body is required');
  const result = await query('INSERT INTO message_templates (account_id, title, body, tags, sort_order) VALUES (?, ?, ?, ?, ?)', [
    id,
    title,
    body,
    JSON.stringify(normalizeTags(data.tags)),
    await nextSortOrder(id),
  ]);
  const rows = await query('SELECT * FROM message_templates WHERE id = ?', [result.insertId]);
  return toSafe(rows[0]);
}

export async function update(id, accountId, data = {}) {
  const tid = Number(id);
  const acc = requireAccount(accountId);
  const existing = await query('SELECT id FROM message_templates WHERE id = ? AND account_id = ?', [tid, acc]);
  if (!existing.length) throw ApiError.notFound('template not found');

  const fields = [];
  const params = [];
  if (data.title !== undefined) {
    const v = String(data.title).trim();
    if (!v) throw ApiError.badRequest('a template title is required');
    fields.push('title = ?');
    params.push(v);
  }
  if (data.body !== undefined) {
    const v = String(data.body).trim();
    if (!v) throw ApiError.badRequest('a template body is required');
    fields.push('body = ?');
    params.push(v);
  }
  if (data.tags !== undefined) {
    fields.push('tags = ?');
    params.push(JSON.stringify(normalizeTags(data.tags)));
  }
  if (fields.length) {
    params.push(tid);
    await query(`UPDATE message_templates SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  const rows = await query('SELECT * FROM message_templates WHERE id = ?', [tid]);
  return toSafe(rows[0]);
}

export async function duplicate(id, accountId) {
  const acc = requireAccount(accountId);
  const rows = await query('SELECT * FROM message_templates WHERE id = ? AND account_id = ?', [Number(id), acc]);
  if (!rows.length) throw ApiError.notFound('template not found');
  const orig = rows[0];
  const t = toSafe(orig);
  const order = Number(orig.sort_order) || 0;
  // Open a gap right after the original so the copy lands next to it (not at the end),
  // and stays there across reloads since the list is ordered by sort_order.
  await query('UPDATE message_templates SET sort_order = sort_order + 1 WHERE account_id = ? AND sort_order > ?', [acc, order]);
  const result = await query('INSERT INTO message_templates (account_id, title, body, tags, sort_order) VALUES (?, ?, ?, ?, ?)', [
    acc,
    `${t.title} (copy)`,
    t.body,
    JSON.stringify(t.tags),
    order + 1,
  ]);
  const created = await query('SELECT * FROM message_templates WHERE id = ?', [result.insertId]);
  return toSafe(created[0]);
}

export async function remove(id, accountId) {
  const acc = requireAccount(accountId);
  const result = await query('DELETE FROM message_templates WHERE id = ? AND account_id = ?', [Number(id), acc]);
  if (!result.affectedRows) throw ApiError.notFound('template not found');
  return { id: Number(id), deleted: true };
}
