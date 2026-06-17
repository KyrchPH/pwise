import { useState } from 'react';
import { Button, Modal } from './ui.jsx';
import { VaultThumb } from './VaultThumb.jsx';
import { formatBytes, useVault } from '../context/VaultContext.jsx';

const MAX = 5;

/**
 * Picks media from the Vault to attach to a chat message. You can navigate
 * folders and multi-select up to {MAX} items of the SAME media type (all photos
 * or all videos). Non-media files are shown but not selectable. Selecting just
 * stages the items — `onAttach` hands them back; the actual send happens later.
 */
export default function VaultPickerModal({ open, onClose, onAttach }) {
  const { childrenOf, pathTo } = useVault();
  const [folderId, setFolderId] = useState(null);
  const [selected, setSelected] = useState([]);

  const items = childrenOf(folderId);
  const folders = items.filter((it) => it.type === 'folder');
  const files = items.filter((it) => it.type === 'file');
  const trail = pathTo(folderId);

  const selType = selected[0]?.mediaType || null;
  const isSelected = (file) => selected.some((s) => s.id === file.id);
  const isMedia = (file) => file.mediaType === 'image' || file.mediaType === 'video';

  // Why a file can't be picked right now (empty string = it can).
  const blockReason = (file) => {
    if (isSelected(file)) return '';
    if (!isMedia(file)) return 'Only photos and videos can be attached';
    if (selType && file.mediaType !== selType) return `You can only attach one type at a time (${selType}s)`;
    if (selected.length >= MAX) return `You can attach up to ${MAX} items`;
    return '';
  };

  const toggle = (file) => {
    // Evaluate the rules against the latest selection so rapid clicks can't slip
    // past the max / single-type limits.
    setSelected((cur) => {
      if (cur.some((s) => s.id === file.id)) return cur.filter((s) => s.id !== file.id);
      if (!isMedia(file)) return cur;
      const curType = cur[0]?.mediaType || null;
      if (curType && file.mediaType !== curType) return cur;
      if (cur.length >= MAX) return cur;
      return [...cur, file];
    });
  };

  const reset = () => {
    setSelected([]);
    setFolderId(null);
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
      title="Attach from Main"
      onClose={close}
      className="modal--vaultpicker"
      footer={
        <>
          <span className="vaultpicker__count">
            {selected.length}/{MAX} selected
          </span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!selected.length} onClick={attach}>
            Attach
          </Button>
        </>
      }
    >
      <nav className="vault__crumbs" aria-label="Folder path">
        <button type="button" className="vault__crumb" onClick={() => setFolderId(null)}>
          Main
        </button>
        {trail.map((folder) => (
          <span key={folder.id} className="vault__crumb-wrap">
            <span className="vault__crumb-sep" aria-hidden="true">/</span>
            <button type="button" className="vault__crumb" onClick={() => setFolderId(folder.id)}>
              {folder.name}
            </button>
          </span>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="vaultpicker__empty">This folder is empty.</p>
      ) : (
        <div className="vaultpicker__grid">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="vaultpicker__item vaultpicker__item--folder"
              onClick={() => setFolderId(folder.id)}
              title={folder.name}
            >
              <span className="vaultpicker__thumb">
                <VaultThumb item={folder} />
              </span>
              <span className="vaultpicker__name">{folder.name}</span>
            </button>
          ))}
          {files.map((file) => {
            const sel = isSelected(file);
            const reason = blockReason(file);
            const blocked = !sel && !!reason;
            return (
              <button
                key={file.id}
                type="button"
                className={`vaultpicker__item${sel ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}`}
                onClick={() => toggle(file)}
                aria-pressed={sel}
                aria-disabled={blocked}
                title={reason || file.name}
              >
                <span className="vaultpicker__thumb">
                  <VaultThumb item={file} />
                  {sel && <span className="vaultpicker__check" aria-hidden="true">✓</span>}
                </span>
                <span className="vaultpicker__name">{file.name}</span>
                <span className="vaultpicker__meta">{formatBytes(file.size)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
