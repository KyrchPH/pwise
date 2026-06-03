import { query } from '../config/db.js';

// Returns the user's settings row, creating a default one if missing.
export async function getForUser(userId, userEmail = null) {
  const rows = await query('SELECT * FROM posting_settings WHERE user_id = ?', [userId]);
  if (rows.length) return rows[0];
  await query('INSERT INTO posting_settings (user_id, owner_email) VALUES (?, ?)', [userId, userEmail]);
  const created = await query('SELECT * FROM posting_settings WHERE user_id = ?', [userId]);
  return created[0];
}

export async function updateForUser(userId, data = {}) {
  await getForUser(userId); // ensure a row exists

  const editable = [
    'is_enabled',
    'timezone',
    'low_pool_alert_threshold',
    'owner_email',
  ];
  const fields = [];
  const params = [];
  for (const key of editable) {
    if (!(key in data)) continue;
    let value = data[key];
    if (key === 'is_enabled') value = data[key] ? 1 : 0;
    fields.push(`${key} = ?`);
    params.push(value);
  }
  if (fields.length) {
    params.push(userId);
    await query(`UPDATE posting_settings SET ${fields.join(', ')} WHERE user_id = ?`, params);
  }
  const rows = await query('SELECT * FROM posting_settings WHERE user_id = ?', [userId]);
  return rows[0];
}
