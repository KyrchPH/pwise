import { useEffect, useState } from 'react';
import { Button, Modal } from './ui.jsx';
import { VaultThumb } from './VaultThumb.jsx';
import { formatBytes, getVaultMediaType, useVault } from '../context/VaultContext.jsx';

const MAX = 5;

/**
 * Picks media from the Vault to attach to a chat message (or a product photo). You
 * can navigate folders and multi-select up to {MAX} items of the SAME media type
 * (all photos or all videos). Non-media files are shown but not selectable. Cards
 * reuse the Vault page's `.vault-item` design; the dialog body scrolls when needed.
 * `initialFolderId` is where the picker opens (e.g. a page's dedicated Vault folder);
 * defaults to the root ("Main"). Selecting just stages the items — `onAttach` hands
 * them back; the actual send happens later.
 */
export default function VaultPickerModal({ open, onClose, onAttach, initialFolderId = null }) {
  const { childrenOf, pathTo } = useVault();
  // Vault item ids are STRINGS, but a page's vault_folder_id arrives as a NUMBER —
  // normalize, or childrenOf()/pathTo() (=== comparisons) silently match nothing and
  // the picker opens "empty" with no breadcrumb trail.
  const startFolderId = initialFolderId != null ? String(initialFolderId) : null;
  const [folderId, setFolderId] = useState(startFolderId);
  const [selected, setSelected] = useState([]);

  // Each time the picker opens, start fresh at its designated folder.
  useEffect(() => {
    if (open) {
      setFolderId(startFolderId);
      setSelected([]);
    }
  }, [open, startFolderId]);

  const items = childrenOf(folderId);
  const folders = items.filter((it) => it.type === 'folder');
  const files = items.filter((it) => it.type === 'file');
  const trail = pathTo(folderId);
  const currentFolderName = trail[trail.length - 1]?.name || 'Main';
  // When opened at a page folder (initialFolderId set), confine navigation to that
  // subtree: the breadcrumb starts at the page folder and omits "Main", so the user
  // can't browse up into the rest of the vault.
  const bounded = startFolderId != null;
  const rootIdx = bounded ? trail.findIndex((f) => String(f.id) === startFolderId) : -1;
  const crumbTrail = rootIdx >= 0 ? trail.slice(rootIdx) : trail;

  const selType = selected[0] ? getVaultMediaType(selected[0]) : null;
  const isSelected = (file) => selected.some((s) => s.id === file.id);
  const isMedia = (file) => {
    const mediaType = getVaultMediaType(file);
    return mediaType === 'image' || mediaType === 'video';
  };

  // Why a file can't be picked right now (empty string = it can).
  const blockReason = (file) => {
    if (isSelected(file)) return '';
    if (!isMedia(file)) return 'Only photos and videos can be attached';
    const mediaType = getVaultMediaType(file);
    if (selType && mediaType !== selType) return `You can only attach one type at a time (${selType}s)`;
    if (selected.length >= MAX) return `You can attach up to ${MAX} items`;
    return '';
  };

  const toggle = (file) => {
    // Evaluate the rules against the latest selection so rapid clicks can't slip
    // past the max / single-type limits.
    setSelected((cur) => {
      if (cur.some((s) => s.id === file.id)) return cur.filter((s) => s.id !== file.id);
      if (!isMedia(file)) return cur;
      const curType = cur[0] ? getVaultMediaType(cur[0]) : null;
      if (curType && getVaultMediaType(file) !== curType) return cur;
      if (cur.length >= MAX) return cur;
      return [...cur, file];
    });
  };

  const reset = () => {
    setSelected([]);
    setFolderId(startFolderId);
  };
  const close = () => {
    reset();
    onClose();
  };
  const attach = () => {
    if (!selected.length) return;
    onAttach(selected);
    reset();
  };

  return (
    <Modal
      open={open}
      title={`Attach from ${currentFolderName}`}
      onClose={close}
      className="modal--vaultpicker"
      footer={
        <>
          {selected.length > 0 && (
            <span className="vaultpicker__count">
              {selected.length}/{MAX} selected
            </span>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!selected.length} onClick={attach}>
            Attach
          </Button>
        </>
      }
    >
      <nav className="vault__crumbs vaultpicker__crumbs" aria-label="Folder path">
        {!bounded && (
          <button type="button" className="vault__crumb" onClick={() => setFolderId(null)}>
            Main
          </button>
        )}
        {crumbTrail.map((folder, i) => (
          <span key={folder.id} className="vault__crumb-wrap">
            {(!bounded || i > 0) && (
              <span className="vault__crumb-sep" aria-hidden="true">/</span>
            )}
            <button type="button" className="vault__crumb" onClick={() => setFolderId(folder.id)}>
              {folder.name}
            </button>
          </span>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="vaultpicker__empty">This folder is empty.</p>
      ) : (
        <div className="vault__grid">
          {folders.map((folder) => (
            <div key={folder.id} className="vault-item vault-item--folder">
              <button
                type="button"
                className="vault-item__open"
                onClick={() => setFolderId(folder.id)}
                title={folder.name}
              >
                <span className="vault-item__thumb vault-item__thumb--folder">
                  <VaultThumb item={folder} />
                </span>
                <span className="vault-item__name">{folder.name}</span>
                <span className="vault-item__meta">{childrenOf(folder.id).length} items</span>
              </button>
            </div>
          ))}
          {files.map((file) => {
            const sel = isSelected(file);
            const reason = blockReason(file);
            const blocked = !sel && !!reason;
            return (
              <div key={file.id} className={`vault-item${sel ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}`}>
                <button
                  type="button"
                  className="vault-item__open"
                  onClick={() => toggle(file)}
                  aria-pressed={sel}
                  aria-disabled={blocked}
                  title={reason || file.name}
                >
                  <span className="vault-item__thumb">
                    <VaultThumb item={file} />
                    {sel && <span className="vaultpicker__check" aria-hidden="true">✓</span>}
                  </span>
                  <span className="vault-item__name">{file.name}</span>
                  <span className="vault-item__meta">{formatBytes(file.size)}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
