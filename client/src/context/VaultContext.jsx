import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Vault — the app's global, shared file explorer. Every signed-in user sees the
 * same files and folders; they can upload, view, download and delete. This is the
 * ONLY place the app imports files from (e.g. the chat media picker reads from
 * here). For now it's an in-memory prototype seeded with sample data; the real
 * backend stores objects in S3 (a follow-up). State lives at the app root so the
 * Vault page and the chat picker share one source of truth for the session.
 */

let seq = 100;
const nextId = () => `vault-${(seq += 1)}`;
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

// Reliable, offline thumbnail: a labelled gradient as an SVG data URI, so sample
// "photos" always render even without a network / real S3 objects.
function svgThumb(label, c1, c2) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs>` +
    `<rect width='400' height='300' fill='url(#g)'/>` +
    `<text x='50%' y='53%' fill='rgba(255,255,255,0.92)' font-family='sans-serif' font-size='26' font-weight='700' text-anchor='middle'>${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function seedItems() {
  const items = [];
  const make = (item) => {
    const it = { id: nextId(), createdAt: Date.now(), uploadedBy: 'Demo User', size: 0, ...item };
    items.push(it);
    return it;
  };
  const brand = make({ name: 'Brand Assets', type: 'folder', parentId: null });
  const proofs = make({ name: 'Job Proofs', type: 'folder', parentId: null });
  make({ name: 'logo-primary.png', type: 'file', mediaType: 'image', parentId: null, size: 84_213, url: svgThumb('logo-primary', '#1f9be6', '#0f6fbb') });
  make({ name: 'price-list.pdf', type: 'file', mediaType: 'file', parentId: null, size: 220_140, url: '' });
  make({ name: 'storefront.jpg', type: 'file', mediaType: 'image', parentId: brand.id, size: 512_900, url: svgThumb('storefront', '#ffc400', '#f3ad00') });
  make({ name: 'mascot.png', type: 'file', mediaType: 'image', parentId: brand.id, size: 130_400, url: svgThumb('mascot', '#45b0f2', '#1f9be6') });
  make({ name: 'sofa-before.jpg', type: 'file', mediaType: 'image', parentId: proofs.id, size: 410_220, url: svgThumb('sofa-before', '#8e7bef', '#5b46c9') });
  make({ name: 'sofa-after.jpg', type: 'file', mediaType: 'image', parentId: proofs.id, size: 398_110, url: svgThumb('sofa-after', '#2dc878', '#1f8a55') });
  make({ name: 'mattress-clean.jpg', type: 'file', mediaType: 'image', parentId: proofs.id, size: 367_540, url: svgThumb('mattress', '#ff8f6b', '#e0574a') });
  make({ name: 'demo-clean.mp4', type: 'file', mediaType: 'video', parentId: proofs.id, size: 4_980_220, url: '' });
  return items;
}

const VaultContext = createContext(null);

export function VaultProvider({ children }) {
  const [items, setItems] = useState(seedItems);

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

  const createFolder = useCallback((parentId, name) => {
    const clean = (name || '').trim();
    if (!clean) return;
    setItems((cur) => [
      ...cur,
      { id: nextId(), name: clean, type: 'folder', parentId: parentId ?? null, createdAt: Date.now(), uploadedBy: 'You' },
    ]);
  }, []);

  const uploadFiles = useCallback((parentId, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setItems((cur) => [
      ...cur,
      ...files.map((f) => {
        const mediaType = getVaultMediaType(f);
        return {
          id: nextId(),
          name: f.name,
          type: 'file',
          parentId: parentId ?? null,
          mediaType,
          // Blob URL previews the file for this session; on reload it falls back to
          // a type icon (real previews come from S3 once the backend is wired).
          url: mediaType === 'image' || mediaType === 'video' ? URL.createObjectURL(f) : '',
          size: f.size,
          createdAt: Date.now(),
          uploadedBy: 'You',
        };
      }),
    ]);
  }, []);

  const deleteItem = useCallback((id) => {
    setItems((cur) => {
      // Collect the item plus all of its descendants (for folders).
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
      cur.forEach((it) => {
        if (doomed.has(it.id) && it.url && it.url.startsWith('blob:')) URL.revokeObjectURL(it.url);
      });
      return cur.filter((it) => !doomed.has(it.id));
    });
  }, []);

  const value = useMemo(
    () => ({ items, childrenOf, getItem, pathTo, createFolder, uploadFiles, deleteItem }),
    [items, childrenOf, getItem, pathTo, createFolder, uploadFiles, deleteItem],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);

// Trigger a browser download for a vault file (best-effort for prototype URLs).
export function downloadVaultItem(item) {
  if (!item || !item.url) return;
  const a = document.createElement('a');
  a.href = item.url;
  a.download = item.name || 'download';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// "1.2 MB" / "84 KB" / "512 B" — compact human file size.
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
