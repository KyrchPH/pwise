import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl, deleteObject } from './s3.service.js';

/**
 * Vault — the app's shared file manager. One self-referencing table holds folders
 * and files; the tree is computed client-side from the full list. Files store an
 * S3 key (+ optional thumbnail key); this service hands the UI short-lived
 * presigned GET URLs for display/download. Shared/global like the rest of the app.
 */

const ALLOWED_MEDIA = ['image', 'video'];

// Shape a row for the client. For files, attach a presigned URL for the object
// (used for preview + download) and, when present, the optimized thumbnail.
async function withUrls(row) {
  const item = {
    id: String(row.id),
    parentId: row.parent_id != null ? String(row.parent_id) : null,
    type: row.type,
    name: row.name,
    mediaType: row.type === 'folder' ? undefined : row.media_type || 'file',
    size: Number(row.size) || 0,
    uploadedBy: row.uploaded_by || '',
    createdAt: row.created_at,
    aiHidden: !!row.ai_hidden, // per-file "Hide from AI" flag (files only; folders are always 0)
    url: '',
    thumbUrl: '',
  };
  if (row.type === 'file') {
    if (row.s3_key) {
      try {
        item.url = await createDownloadUrl(row.s3_key);
      } catch {
        /* S3 not configured / object missing */
      }
    }
    if (row.thumbnail_s3_key) {
      try {
        item.thumbUrl = await createDownloadUrl(row.thumbnail_s3_key);
      } catch {
        /* ignore */
      }
    }
  }
  return item;
}

async function getRow(id) {
  const rows = await query('SELECT * FROM vault_items WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('vault item not found');
  return rows[0];
}

async function assertFolder(id) {
  const rows = await query('SELECT id, type FROM vault_items WHERE id = ?', [id]);
  if (!rows.length || rows[0].type !== 'folder') throw ApiError.badRequest('parent folder not found');
}

// Every item, folders first then files, A→Z. The dataset is small (a team's
// shared files), so the client fetches the whole tree and slices it per folder.
export async function listAll() {
  const rows = await query('SELECT * FROM vault_items ORDER BY type DESC, name ASC, id ASC');
  return Promise.all(rows.map(withUrls));
}

export async function getItem(id) {
  return withUrls(await getRow(id));
}

export async function createFolder(actor = {}, { parentId = null, name } = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) throw ApiError.badRequest('a folder name is required');
  if (clean.length > 255) throw ApiError.badRequest('name is too long (max 255 characters)');
  if (parentId != null) await assertFolder(parentId);
  const result = await query(
    'INSERT INTO vault_items (parent_id, type, name, user_id, uploaded_by) VALUES (?, "folder", ?, ?, ?)',
    [parentId ?? null, clean, actor.id ?? null, actor.name ?? null],
  );
  return getItem(result.insertId);
}

// Persist a file AFTER its bytes (and any thumbnail) are already in S3 — the
// client uploads directly via a presigned URL, then calls this with the key.
export async function createFile(actor = {}, data = {}) {
  const name = String(data.name ?? '').trim();
  if (!name) throw ApiError.badRequest('a file name is required');
  const s3Key = String(data.s3Key ?? '').trim();
  if (!s3Key) throw ApiError.badRequest('s3Key is required');
  // Guard against pointing the record at an arbitrary object: vault uploads live
  // under vault/ (see upload.controller presignedUrl).
  if (!s3Key.startsWith('vault/')) throw ApiError.badRequest('invalid s3Key for a vault file');
  if (data.parentId != null) await assertFolder(data.parentId);
  const mediaType = ALLOWED_MEDIA.includes(data.mediaType) ? data.mediaType : 'file';
  const thumbKey = data.thumbnailS3Key ? String(data.thumbnailS3Key).trim() : null;

  const result = await query(
    `INSERT INTO vault_items (parent_id, type, name, media_type, mime_type, s3_key, thumbnail_s3_key, size, user_id, uploaded_by)
     VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.parentId ?? null,
      name,
      mediaType,
      data.mime ? String(data.mime).slice(0, 150) : null,
      s3Key,
      thumbKey,
      Number(data.size) || 0,
      actor.id ?? null,
      actor.name ?? null,
    ],
  );
  return getItem(result.insertId);
}

// Move an item under a new parent folder (newParentId null/'' → root). Guards
// against folder cycles: a folder can't be moved into itself or any of its own
// descendants. No-op (returns the item unchanged) if it's already there.
export async function move(id, newParentId) {
  const row = await getRow(id); // 404 if missing
  const parentId = newParentId == null || newParentId === '' ? null : Number(newParentId);
  if (parentId != null) {
    await assertFolder(parentId);
    if (row.type === 'folder') {
      const subtree = await collectSubtree(id); // [id, ...descendants]
      if (subtree.includes(parentId)) throw ApiError.badRequest("can't move a folder inside itself");
    }
  }
  const currentParent = row.parent_id != null ? Number(row.parent_id) : null;
  if (currentParent === parentId) return getItem(id); // already there — nothing to do
  await query('UPDATE vault_items SET parent_id = ? WHERE id = ?', [parentId, id]);
  return getItem(id);
}

// Collect an item plus every descendant id (iterative BFS — no recursive CTE
// dependency). Used to clean up S3 objects before the cascading row delete.
async function collectSubtree(rootId) {
  const ids = [Number(rootId)];
  let frontier = [Number(rootId)];
  while (frontier.length) {
    const rows = await query(
      `SELECT id FROM vault_items WHERE parent_id IN (${frontier.map(() => '?').join(',')})`,
      frontier,
    );
    const next = rows.map((r) => Number(r.id));
    if (!next.length) break;
    ids.push(...next);
    frontier = next;
  }
  return ids;
}

// Delete a folder (and everything inside) or a single file. The FK cascade removes
// descendant rows; we delete their S3 objects first so nothing is orphaned.
export async function remove(id) {
  await getRow(id); // 404 if missing
  const ids = await collectSubtree(id);
  const files = await query(
    `SELECT s3_key, thumbnail_s3_key FROM vault_items WHERE type = 'file' AND id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  await query('DELETE FROM vault_items WHERE id = ?', [id]); // cascades to descendants
  for (const f of files) {
    if (f.s3_key) await deleteObject(f.s3_key); // best-effort
    if (f.thumbnail_s3_key) await deleteObject(f.thumbnail_s3_key);
  }
  return { id: Number(id), deleted: true };
}

// Toggle a FILE's "Hide from AI" flag — hidden files are excluded from the agent's
// media search (searchAiMedia) and shown with a distinct card in the Vault UI.
// Folders aren't AI-searched directly, so the flag only applies to files.
export async function setAiHidden(id, hidden) {
  const row = await getRow(id); // 404 if missing
  if (row.type !== 'file') throw ApiError.badRequest('only files can be hidden from the AI');
  await query('UPDATE vault_items SET ai_hidden = ? WHERE id = ?', [hidden ? 1 : 0, id]);
  return getItem(id);
}

// AI media search: media files (image/video, NOT ai_hidden) anywhere under
// `folderId`'s subtree whose name matches the query keywords, ranked by how many
// keywords hit the name, each with a fresh signed URL. The page's folder is the
// scope, so the messaging `send_media` tool only ever reaches that page's files.
export async function searchAiMedia(folderId, rawQuery, { limit = 5 } = {}) {
  const fid = parseInt(folderId, 10);
  const q = String(rawQuery ?? '').trim().toLowerCase();
  if (!Number.isInteger(fid) || !q) return [];

  const ids = await collectSubtree(fid); // [folder, ...descendants]
  if (!ids.length) return [];
  const rows = await query(
    `SELECT id, name, media_type, s3_key FROM vault_items
      WHERE type = 'file' AND ai_hidden = 0 AND media_type IN ('image', 'video')
        AND parent_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  if (!rows.length) return [];

  const tokens = q.split(/\s+/).filter(Boolean);
  const ranked = rows
    .map((row) => {
      const name = String(row.name || '').toLowerCase();
      const score = tokens.reduce((s, t) => (name.includes(t) ? s + 1 : s), 0);
      return { row, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.name).localeCompare(String(b.row.name)))
    .slice(0, Math.min(Math.max(parseInt(limit, 10) || 5, 1), 10));

  const out = [];
  for (const { row } of ranked) {
    let url = '';
    if (row.s3_key) {
      try {
        url = await createDownloadUrl(row.s3_key);
      } catch {
        /* S3 not configured / object missing — skip this one */
      }
    }
    if (url) out.push({ id: String(row.id), name: row.name, mediaType: row.media_type || 'image', url });
  }
  return out;
}
