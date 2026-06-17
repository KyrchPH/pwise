import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../../components/ui.jsx';
import { VaultThumb } from '../../components/VaultThumb.jsx';
import { downloadVaultItem, formatBytes, useVault } from '../../context/VaultContext.jsx';

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export default function VaultPage() {
  const { childrenOf, pathTo, createFolder, uploadFiles, deleteItem } = useVault();
  const [folderId, setFolderId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const addMenuRef = useRef(null);

  const items = childrenOf(folderId);
  const folders = items.filter((it) => it.type === 'folder');
  const files = items.filter((it) => it.type === 'file');
  const trail = pathTo(folderId);

  useEffect(() => {
    if (!addMenuOpen) return undefined;
    const onDown = (event) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target)) setAddMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [addMenuOpen]);

  const handleUpload = (event) => {
    uploadFiles(folderId, event.target.files);
    event.target.value = '';
    setAddMenuOpen(false);
  };

  const submitFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    createFolder(folderId, name);
    setNewFolderName('');
    setNewFolderOpen(false);
  };

  const doDelete = () => {
    if (confirmDelete) deleteItem(confirmDelete.id);
    setConfirmDelete(null);
  };

  const openNewFolder = () => {
    setAddMenuOpen(false);
    setNewFolderOpen(true);
  };

  const openUploadPicker = () => {
    setAddMenuOpen(false);
    fileInputRef.current?.click();
  };

  return (
    <div className="vault">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Vault</h1>
          <p className="page-head__sub">Shared files and media for everyone on the team.</p>
        </div>
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleUpload} />

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
            <div className="vault-item__actions">
              <button
                type="button"
                className="vault-item__act vault-item__act--danger"
                onClick={() => setConfirmDelete(folder)}
                aria-label={`Delete ${folder.name}`}
                title="Delete"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
        {files.map((file) => (
          <div key={file.id} className="vault-item">
            <button
              type="button"
              className="vault-item__open"
              onClick={() => setPreview(file)}
              title={file.name}
            >
              <span className="vault-item__thumb">
                <VaultThumb item={file} />
              </span>
              <span className="vault-item__name">{file.name}</span>
              <span className="vault-item__meta">{formatBytes(file.size)}</span>
            </button>
            <div className="vault-item__actions">
              <button
                type="button"
                className="vault-item__act"
                onClick={() => downloadVaultItem(file)}
                aria-label={`Download ${file.name}`}
                title="Download"
              >
                <DownloadIcon />
              </button>
              <button
                type="button"
                className="vault-item__act vault-item__act--danger"
                onClick={() => setConfirmDelete(file)}
                aria-label={`Delete ${file.name}`}
                title="Delete"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}

        <div ref={addMenuRef} className={`vault-add${addMenuOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="vault-add__card"
            onClick={() => setAddMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            title="Add"
          >
            <span className="vault-add__icon">
              <PlusIcon />
            </span>
            <span className="vault-add__label">Add</span>
            <span className="vault-add__meta">New folder or file</span>
          </button>
          {addMenuOpen && (
            <div className="vault-add__menu" role="menu" aria-label="Add options">
              <button type="button" className="vault-add__option" role="menuitem" onClick={openNewFolder}>
                Add new folder
              </button>
              <button type="button" className="vault-add__option" role="menuitem" onClick={openUploadPicker}>
                Upload a file
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={newFolderOpen}
        title="New folder"
        onClose={() => setNewFolderOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!newFolderName.trim()} onClick={submitFolder}>
              Create
            </Button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          value={newFolderName}
          onChange={(event) => setNewFolderName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submitFolder()}
          placeholder="Folder name"
          aria-label="Folder name"
        />
      </Modal>

      <Modal open={!!preview} title={preview?.name} onClose={() => setPreview(null)} className="modal--vaultpreview">
        {preview && (
          <div className="vault-preview">
            {preview.mediaType === 'image' && preview.url ? (
              <img className="vault-preview__media" src={preview.url} alt={preview.name} />
            ) : preview.mediaType === 'video' && preview.url ? (
              <video className="vault-preview__media" src={preview.url} controls autoPlay />
            ) : (
              <div className="vault-preview__none">
                <VaultThumb item={preview} />
                <p>No preview available for this file type.</p>
                <Button variant="subtle" onClick={() => downloadVaultItem(preview)}>
                  Download
                </Button>
              </div>
            )}
            <div className="vault-preview__meta">
              {formatBytes(preview.size)} - Uploaded by {preview.uploadedBy}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.type === 'folder' ? 'folder' : 'file'}?`}
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p className="vault-delete-text">
          {confirmDelete?.type === 'folder'
            ? `"${confirmDelete?.name}" and everything inside it will be permanently removed.`
            : `"${confirmDelete?.name}" will be permanently removed.`}
        </p>
      </Modal>
    </div>
  );
}
