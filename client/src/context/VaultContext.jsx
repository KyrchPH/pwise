import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import * as vaultApi from '../services/vault.service.js';
import * as upload from '../services/upload.service.js';

/**
 * Vault — the app's global, shared file manager. Every signed-in user sees the
 * same folders and files; they can upload, view, download and delete. Files live
 * in S3 and are recorded in the `vault_items` table; this provider fetches the
 * whole tree once and slices it per-folder client-side, so the Vault page and the
 * chat media picker share one source of truth. Mutations go through the API.
 */

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv']);

function extensionOf(name) {
  return String(name || '')
    .trim()
    .split('.')
    .pop()
    .toLowerCase();
}

export function getVaultMediaType(item) {
  if (item?.mediaType === 'image' || item?.type?.startsWith?.('image/')) return 'image';
  if (item?.mediaType === 'video' || item?.type?.startsWith?.('video/')) return 'video';
  const ext = extensionOf(item?.name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'file';
}

const VaultContext = createContext(null);

export function VaultProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const list = await vaultApi.list();
      setItems(list);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const childrenOf = useCallback(
    (parentId) => items.filter((it) => it.parentId === (parentId ?? null)),
    [items],
  );

  const getItem = useCallback((id) => items.find((it) => it.id === id) || null, [items]);

  // Breadcrumb trail of folders from the root down to `id` (exclusive of root).
  const pathTo = useCallback(
    (id) => {
      const trail = [];
      let cur = id ? items.find((it) => it.id === id) : null;
      while (cur) {
        trail.unshift(cur);
        cur = cur.parentId ? items.find((it) => it.id === cur.parentId) : null;
      }
      return trail;
    },
    [items],
  );

  const createFolder = useCallback(async (parentId, name) => {
    const clean = (name || '').trim();
    if (!clean) return null;
    const item = await vaultApi.createFolder(parentId ?? null, clean);
    setItems((cur) => [...cur, item]);
    return item;
  }, []);

  // Upload each file straight to S3 (presigned PUT), generate + upload an optimized
  // thumbnail for images/videos, then record the file in the vault. Items appear as
  // each one finishes. Reports progress per file via onProgress(index, patch) —
  // patch is { status, percent, error? } where status is uploading|processing|done|error.
  // Doesn't throw: one file's failure doesn't abort the rest. Returns { uploaded, failed }.
  const uploadFiles = useCallback(async (parentId, fileList, onProgress) => {
    const files = Array.from(fileList || []);
    if (!files.length) return { uploaded: 0, failed: 0 };
    const report = (index, patch) => onProgress?.(index, patch);
    let uploaded = 0;
    let failed = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const mediaType = getVaultMediaType(file);
      const isMedia = mediaType === 'image' || mediaType === 'video';
      try {
        report(index, { status: 'uploading', percent: 0 });
        const pres = await upload.getPresignedUrl(file.name, file.type || 'application/octet-stream', { vault: true });
        // The S3 PUT is the bulk of the time — stream its 0..100 progress to the UI.
        await upload.uploadToS3(pres.uploadUrl, file, (percent) => report(index, { status: 'uploading', percent }));

        // Bytes are in S3; the thumbnail + DB record are quick — show a processing state.
        report(index, { status: 'processing', percent: 100 });
        let thumbnailS3Key = null;
        if (isMedia) {
          try {
            const thumb = await upload.uploadThumbnail(file, { vault: true });
            if (thumb) thumbnailS3Key = thumb.s3Key;
          } catch {
            /* best-effort — a file without a thumbnail still works */
          }
        }

        const item = await vaultApi.createFile({
          parentId: parentId ?? null,
          name: file.name,
          s3Key: pres.s3Key,
          thumbnailS3Key,
          mediaType,
          mime: file.type || null,
          size: file.size,
        });
        setItems((cur) => [...cur, item]);
        uploaded += 1;
        report(index, { status: 'done', percent: 100 });
      } catch (err) {
        failed += 1;
        report(index, { status: 'error', percent: 0, error: err?.message || 'Upload failed' });
      }
    }

    return { uploaded, failed };
  }, []);

  // Move an item into another folder (parentId null → root). Updates the moved
  // row's parentId locally so it re-slices into the new folder immediately.
  const moveItem = useCallback(async (id, parentId) => {
    const updated = await vaultApi.move(id, parentId ?? null);
    setItems((cur) => cur.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
    return updated;
  }, []);

  // Flip a file's "Hide from AI" flag and patch it into the tree in place.
  const setItemAiHidden = useCallback(async (id, aiHidden) => {
    const updated = await vaultApi.setAiHidden(id, aiHidden);
    setItems((cur) => cur.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
    return updated;
  }, []);

  const deleteItem = useCallback(async (id) => {
    await vaultApi.remove(id);
    setItems((cur) => {
      // Drop the item plus all of its descendants (the server cascades the rows).
      const doomed = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of cur) {
          if (it.parentId && doomed.has(it.parentId) && !doomed.has(it.id)) {
            doomed.add(it.id);
            grew = true;
          }
        }
      }
      return cur.filter((it) => !doomed.has(it.id));
    });
  }, []);

  const value = useMemo(
    () => ({ items, loading, error, refresh, childrenOf, getItem, pathTo, createFolder, uploadFiles, moveItem, deleteItem, setItemAiHidden }),
    [items, loading, error, refresh, childrenOf, getItem, pathTo, createFolder, uploadFiles, moveItem, deleteItem, setItemAiHidden],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);

// Open/download a vault file. The URL is a presigned S3 link; the `download`
// attribute is ignored cross-origin, so this opens in a new tab (the browser
// downloads non-viewable types and shows viewable ones to save).
export function downloadVaultItem(item) {
  if (!item || !item.url) return;
  const a = document.createElement('a');
  a.href = item.url;
  a.download = item.name || 'download';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// "1.2 MB" / "84 KB" / "512 B" — compact human file size.
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
