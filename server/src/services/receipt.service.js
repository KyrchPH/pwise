import { query } from '../config/db.js';
import { isAdminRole } from '../config/modules.js';
import ApiError from '../utils/ApiError.js';
import * as s3 from './s3.service.js';

// Receipts — owner-scoped document/photo storage (Shop → Receipts). Only the uploader can
// see their own receipts; admins bypass (same shape as vault's per-user access). The file
// lives in a private S3 object (receipts/{userId}/…) recorded here after a direct upload;
// reads hand back a short-lived presigned URL.

function requireAccount(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('a valid page (accountId) is required');
  return id;
}

async function withUrl(r) {
  let url = null;
  try {
    url = await s3.createDownloadUrl(r.s3_key);
  } catch {
    url = null; // S3 not configured / object gone — the row still lists, just without a link
  }
  return {
    id: Number(r.id),
    accountId: r.account_id,
    createdBy: r.created_by ?? null,
    createdByName: r.created_by_name || null,
    title: r.title || null,
    contentType: r.content_type || null,
    fileSize: r.file_size == null ? null : Number(r.file_size),
    note: r.note || null,
    orderId: r.order_id ?? null,
    createdAt: r.created_at,
    url,
    isImage: String(r.content_type || '').startsWith('image/'),
    isPdf: String(r.content_type || '') === 'application/pdf',
  };
}

export async function create({ actor = {}, accountId, s3Key, contentType, fileSize, title, note, orderId } = {}) {
  const acc = requireAccount(accountId);
  const key = String(s3Key || '');
  // The key must be one this user just uploaded under their own receipts/ prefix.
  if (!key.startsWith(`receipts/${actor.id}/`)) throw ApiError.badRequest('invalid receipt upload key');
  const res = await query(
    `INSERT INTO receipts (account_id, created_by, created_by_name, title, s3_key, content_type, file_size, note, order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      acc, actor.id ?? null, actor.name ?? null,
      title ? String(title).slice(0, 255) : null,
      key, contentType ? String(contentType).slice(0, 120) : null,
      fileSize == null ? null : Number(fileSize),
      note ? String(note).slice(0, 2000) : null,
      orderId == null ? null : Number(orderId),
    ],
  );
  const rows = await query('SELECT * FROM receipts WHERE id = ?', [res.insertId]);
  return withUrl(rows[0]);
}

export async function list({ actor = {}, accountId, ownerId = null } = {}) {
  const acc = requireAccount(accountId);
  const where = ['account_id = ?'];
  const params = [acc];
  if (!isAdminRole(actor.role)) {
    where.push('created_by = ?');
    params.push(actor.id);
  } else if (ownerId != null && ownerId !== '' && ownerId !== 'all') {
    where.push('created_by = ?');
    params.push(Number(ownerId));
  }
  const rows = await query(`SELECT * FROM receipts WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`, params);
  return Promise.all(rows.map(withUrl));
}

async function getGuarded(id, actor) {
  const rows = await query('SELECT * FROM receipts WHERE id = ? LIMIT 1', [id]);
  const row = rows[0];
  if (!row) throw ApiError.notFound('receipt not found');
  if (!isAdminRole(actor?.role) && Number(row.created_by) !== Number(actor?.id)) {
    throw ApiError.forbidden('this receipt belongs to another user');
  }
  return row;
}

export async function getDownloadUrl(id, actor) {
  const row = await getGuarded(id, actor);
  const url = await s3.createDownloadUrl(row.s3_key);
  return { url };
}

export async function remove(id, actor) {
  const row = await getGuarded(id, actor);
  await s3.deleteObject(row.s3_key); // best-effort; never throws
  await query('DELETE FROM receipts WHERE id = ?', [id]);
  return { id: Number(id), deleted: true };
}
