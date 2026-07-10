import { query } from '../config/db.js';
import { isAdminRole } from '../config/modules.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl, deleteObject } from './s3.service.js';

/**
 * Vault — the app's shared file manager. One self-referencing table holds folders
 * and files; the tree is computed client-side from the full list. Files store an
 * S3 key (+ optional thumbnail key); this service hands the UI short-lived
 * presigned GET URLs for display/download. Shared/global like the rest of the app.
 */

const ALLOWED_MEDIA = ['image', 'video'];
const MAX_DESCRIPTION_LEN = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;

// Stored tags are a normalized comma-separated string; hand the client an array.
function splitTags(raw) {
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// Accept tags as an array or a comma string; normalize to a clean, de-duped,
// lowercased comma string (trimmed, capped in count + length) for storage.
function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out.join(',');
}

function normalizeDescription(input) {
  const text = String(input ?? '').trim();
  return text ? text.slice(0, MAX_DESCRIPTION_LEN) : null;
}

// Shape a row for the client. For files, attach a presigned URL for the object
// (used for preview + download) and, when present, the optimized thumbnail.
async function withUrls(row) {
  const item = {
    id: String(row.id),
    parentId: row.parent_id != null ? String(row.parent_id) : null,
    type: row.type,
    name: row.name,
    mediaType: row.type === 'folder' ? undefined : row.media_type || 'file',
    visibility: row.type === 'folder' ? (row.visibility === 'private' ? 'private' : 'public') : undefined, // folders only
    size: Number(row.size) || 0,
    uploadedBy: row.uploaded_by || '',
    createdAt: row.created_at,
    aiHidden: !!row.ai_hidden, // per-file "Hide from AI" flag (files only; folders are always 0)
    description: row.description || '', // AI metadata: free-text description…
    tags: splitTags(row.tags), //                …and curated keyword tags
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
// Access control: a PRIVATE folder — and its whole subtree — is stripped for any
// non-admin who isn't on its allow-list, so unauthorized users never see (or get a
// signed URL for) anything inside it. Admins see everything.
export async function listAll(actor = {}) {
  const rows = await query('SELECT * FROM vault_items ORDER BY type DESC, name ASC, id ASC');
  const visible = isAdminRole(actor.role) ? rows : await filterByAccess(rows, actor);
  return Promise.all(visible.map(withUrls));
}

// Drop every item under a private folder the user can't access: build a parent→children
// index once, then remove the subtree of each blocked private folder (handles nesting —
// an inaccessible outer folder hides accessible inner ones too, since you can't reach them).
async function filterByAccess(rows, actor) {
  const privateFolders = rows.filter((r) => r.type === 'folder' && r.visibility === 'private');
  if (!privateFolders.length) return rows; // nothing restricted → everyone sees all
  const granted = await grantedFolderIds(actor.id);
  const toHide = privateFolders.filter((r) => !granted.has(Number(r.id)));
  if (!toHide.length) return rows; // user is on every private folder's list
  const byParent = new Map();
  for (const r of rows) {
    const p = r.parent_id != null ? Number(r.parent_id) : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(Number(r.id));
  }
  const hidden = new Set();
  const stack = toHide.map((r) => Number(r.id));
  while (stack.length) {
    const id = stack.pop();
    if (hidden.has(id)) continue;
    hidden.add(id);
    for (const child of byParent.get(id) || []) stack.push(child);
  }
  return rows.filter((r) => !hidden.has(Number(r.id)));
}

// Private-folder ids a user is explicitly allowed into.
async function grantedFolderIds(userId) {
  if (!userId) return new Set();
  const rows = await query('SELECT folder_id FROM vault_folder_access WHERE user_id = ?', [userId]);
  return new Set(rows.map((r) => Number(r.folder_id)));
}

// Throw 403 if a non-admin acts on an item sitting inside a private folder they can't
// access. Walks the (shallow) ancestor chain. No-op for admins / items with no private
// ancestor. Complements listAll's filtering so private contents can't be reached by id.
async function assertCanAccess(actor = {}, id) {
  if (isAdminRole(actor.role) || id == null) return;
  const privateAncestors = [];
  let cursor = id;
  const seen = new Set();
  while (cursor != null && !seen.has(Number(cursor))) {
    seen.add(Number(cursor));
    const rows = await query('SELECT id, parent_id, type, visibility FROM vault_items WHERE id = ?', [cursor]);
    if (!rows.length) break;
    if (rows[0].type === 'folder' && rows[0].visibility === 'private') privateAncestors.push(Number(rows[0].id));
    cursor = rows[0].parent_id;
  }
  if (!privateAncestors.length) return;
  const granted = await grantedFolderIds(actor.id);
  for (const fid of privateAncestors) {
    if (!granted.has(fid)) throw ApiError.forbidden('you do not have access to this folder');
  }
}

// Replace a private folder's allow-list with `userIds` (validated against real users).
async function replaceGrants(folderId, userIds) {
  await query('DELETE FROM vault_folder_access WHERE folder_id = ?', [folderId]);
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  if (!ids.length) return;
  const real = await query(`SELECT id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const valid = real.map((r) => Number(r.id));
  if (!valid.length) return;
  const params = [];
  for (const uid of valid) params.push(folderId, uid);
  await query(`INSERT INTO vault_folder_access (folder_id, user_id) VALUES ${valid.map(() => '(?, ?)').join(', ')}`, params);
}

export async function getItem(id) {
  return withUrls(await getRow(id));
}

export async function createFolder(actor = {}, { parentId = null, name, visibility, accessUserIds } = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) throw ApiError.badRequest('a folder name is required');
  if (clean.length > 255) throw ApiError.badRequest('name is too long (max 255 characters)');
  if (parentId != null) {
    await assertFolder(parentId);
    await assertCanAccess(actor, parentId); // can't create inside a private folder you can't see
  }
  // Only admins may restrict a folder; everyone else's folders are public (the default).
  const isPrivate = isAdminRole(actor.role) && String(visibility) === 'private';
  const result = await query(
    'INSERT INTO vault_items (parent_id, type, name, visibility, user_id, uploaded_by) VALUES (?, "folder", ?, ?, ?, ?)',
    [parentId ?? null, clean, isPrivate ? 'private' : 'public', actor.id ?? null, actor.name ?? null],
  );
  if (isPrivate) await replaceGrants(result.insertId, accessUserIds);
  return getItem(result.insertId);
}

// Read a folder's access config for the admin manage-access UI. Admin-only (route).
// Joins users so the client can render the current allow-list as chips even for people
// who aren't among the admin's connection suggestions (e.g. a since-removed connection).
export async function getFolderAccess(id) {
  const rows = await query('SELECT id, type, visibility FROM vault_items WHERE id = ?', [id]);
  if (!rows.length || rows[0].type !== 'folder') throw ApiError.notFound('folder not found');
  const grants = await query(
    'SELECT u.id, u.name, u.email FROM vault_folder_access a JOIN users u ON u.id = a.user_id WHERE a.folder_id = ?',
    [id],
  );
  return {
    id: String(id),
    visibility: rows[0].visibility === 'private' ? 'private' : 'public',
    userIds: grants.map((r) => String(r.id)),
    users: grants.map((r) => ({ id: r.id, name: r.name, email: r.email })),
  };
}

// Set a folder's visibility + allow-list. Admin-only (route). 'public' clears the list.
export async function setFolderAccess(id, { visibility, userIds } = {}) {
  const rows = await query('SELECT id, type FROM vault_items WHERE id = ?', [id]);
  if (!rows.length || rows[0].type !== 'folder') throw ApiError.notFound('folder not found');
  const isPrivate = String(visibility) === 'private';
  await query('UPDATE vault_items SET visibility = ? WHERE id = ?', [isPrivate ? 'private' : 'public', id]);
  if (isPrivate) await replaceGrants(id, userIds);
  else await query('DELETE FROM vault_folder_access WHERE folder_id = ?', [id]);
  return getItem(id);
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
  if (data.parentId != null) {
    await assertFolder(data.parentId);
    await assertCanAccess(actor, data.parentId); // can't upload into a private folder you can't see
  }
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
export async function move(actor, id, newParentId) {
  const row = await getRow(id); // 404 if missing
  await assertCanAccess(actor, id); // can't move something you can't access
  const parentId = newParentId == null || newParentId === '' ? null : Number(newParentId);
  if (parentId != null) {
    await assertFolder(parentId);
    await assertCanAccess(actor, parentId); // ...or into a private folder you can't access
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
export async function remove(actor, id) {
  await getRow(id); // 404 if missing
  await assertCanAccess(actor, id);
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
export async function setAiHidden(actor, id, hidden) {
  const row = await getRow(id); // 404 if missing
  await assertCanAccess(actor, id);
  if (row.type !== 'file') throw ApiError.badRequest('only files can be hidden from the AI');
  await query('UPDATE vault_items SET ai_hidden = ? WHERE id = ?', [hidden ? 1 : 0, id]);
  return getItem(id);
}

// Update a file's AI metadata — free-text `description` and curated `tags` (the
// agent matches a customer's words against both, with tags weighted highest; see
// searchAiMedia). Either field may be omitted to leave it unchanged.
export async function updateMeta(actor, id, { description, tags } = {}) {
  const row = await getRow(id); // 404 if missing
  await assertCanAccess(actor, id);
  const nextDescription = description === undefined ? (row.description ?? null) : normalizeDescription(description);
  const nextTags = tags === undefined ? (row.tags ?? '') : normalizeTags(tags);
  await query('UPDATE vault_items SET description = ?, tags = ? WHERE id = ?', [nextDescription, nextTags, row.id]);
  return getItem(row.id);
}

// AI media search: media files (image/video, NOT ai_hidden) anywhere under
// `folderId`'s subtree whose tags / name / description match the query keywords,
// ranked by a weighted score (curated tags beat the filename, which beats the
// free-text description), each with a fresh signed URL. The page's folder is the
// scope, so the messaging `send_media` tool only ever reaches that page's files.
export async function searchAiMedia(folderId, rawQuery, { limit = 5 } = {}) {
  const fid = parseInt(folderId, 10);
  const q = String(rawQuery ?? '').trim().toLowerCase();
  if (!Number.isInteger(fid) || !q) return [];

  const ids = await collectSubtree(fid); // [folder, ...descendants]
  if (!ids.length) return [];
  const rows = await query(
    `SELECT id, name, media_type, s3_key, tags, description FROM vault_items
      WHERE type = 'file' AND ai_hidden = 0 AND media_type IN ('image', 'video')
        AND parent_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  if (!rows.length) return [];

  // Tokens cleaned of surrounding punctuation ("(KIT" -> "kit"); 1-char noise dropped.
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((t) => t.length >= 2);
  if (!tokens.length) return [];

  const ranked = rows
    .map((row) => {
      const name = String(row.name || '').toLowerCase();
      const tags = String(row.tags || '').toLowerCase();
      const description = String(row.description || '').toLowerCase();
      // Strong signal = the curated fields (tags ×3, filename ×2) — what the photo IS.
      // Weak signal = the free-text description (×1) — often just an incidental mention
      // (e.g. one item inside a bundle's contents list). A token can score in several
      // fields; the contributions add up.
      let strong = 0;
      let weak = 0;
      for (const t of tokens) {
        if (tags.includes(t)) strong += 3;
        if (name.includes(t)) strong += 2;
        if (description.includes(t)) weak += 1;
      }
      return { row, strong, score: strong + weak };
    })
    // Require a tag/filename hit. A description-only match is too weak to auto-send: it's
    // why "5L Car Shampoo" used to return a bundle photo that merely lists car shampoo
    // among its 20 items. When the real photo isn't in the Vault we now return nothing,
    // so the agent says it has no photo instead of sending a wrong one. (Description still
    // boosts ranking among qualified matches.)
    .filter((x) => x.strong > 0)
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
    if (url) {
      out.push({
        id: String(row.id),
        name: row.name,
        mediaType: row.media_type || 'image',
        url,
        description: row.description || '', // so the agent can describe what it picked…
        tags: splitTags(row.tags), //          …and reason over / offer alternatives
      });
    }
  }
  return out;
}

// Pull a peso amount out of a media caption (e.g. "Package Price ₱21,000" → 21000) so
// Vault-only items can be price-compared like real products. Prefers an amount tagged
// with the word "price"; else the first ₱/PHP/P amount. Returns a number or null. (The
// full description is still returned too — price is just a convenience for comparisons.)
function extractPrice(text) {
  const s = String(text || '');
  const RE = /(?:₱|php|\bp)\s*([\d][\d,]*(?:\.\d+)?)/gi;
  let first = null;
  let labeled = null;
  let m;
  while ((m = RE.exec(s)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(val) || val <= 0) continue;
    if (first == null) first = val;
    if (/price/i.test(s.slice(Math.max(0, m.index - 24), m.index))) { labeled = val; break; }
  }
  return labeled != null ? labeled : first;
}

// Metadata-only AI media search for the agent's KNOWLEDGE lookup (no signed URLs —
// text only, and far cheaper than searchAiMedia). The Vault is a SECOND source of
// product info: a tagged image's name/description/tags often carry the details (and
// the price in the caption) for items that aren't in the products table. Empty query →
// all media under the folder; otherwise a simple keyword overlap. Skips ai_hidden and
// non-image/video files. Returns [{ name, description, tags }].
export async function searchAiMediaMeta(folderId, rawQuery, { limit = 50 } = {}) {
  const fid = parseInt(folderId, 10);
  if (!Number.isInteger(fid)) return [];
  const ids = await collectSubtree(fid);
  if (!ids.length) return [];
  const rows = await query(
    `SELECT name, tags, description FROM vault_items
      WHERE type = 'file' AND ai_hidden = 0 AND media_type IN ('image', 'video')
        AND parent_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  if (!rows.length) return [];

  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const toMeta = (row) => ({ name: row.name, price: extractPrice(row.description), description: row.description || '', tags: splitTags(row.tags) });

  const q = String(rawQuery ?? '').trim().toLowerCase();
  if (!q) return rows.slice(0, lim).map(toMeta); // list all

  const tokens = q.split(/\s+/).filter(Boolean);
  return rows
    .map((row) => {
      const hay = `${row.name || ''} ${row.tags || ''} ${row.description || ''}`.toLowerCase();
      const score = tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { row, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, lim)
    .map((x) => toMeta(x.row));
}
