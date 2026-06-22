import { useEffect, useRef, useState } from 'react';
import { Button, Card, Dropdown, Modal, Spinner } from '../../components/ui.jsx';
import { VaultThumb } from '../../components/VaultThumb.jsx';
import { downloadVaultItem, formatBytes, getVaultMediaType, useVault } from '../../context/VaultContext.jsx';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

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

// Visible to AI (click to hide).
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Hidden from AI (click to show).
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

const DOCUMENT_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']);
const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'All items' },
  { value: 'folders', label: 'Folders' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'documents', label: 'Documents' },
  { value: 'files', label: 'Other files' },
];
const SORT_OPTIONS = [
  { value: 'name', label: 'Name A-Z' },
  { value: 'newest', label: 'Newest first' },
  { value: 'largest', label: 'Largest first' },
];

function extensionOf(name) {
  return String(name || '')
    .trim()
    .split('.')
    .pop()
    .toLowerCase();
}

function vaultFilterKind(item) {
  if (item.type === 'folder') return 'folder';
  const mediaType = getVaultMediaType(item);
  if (mediaType === 'image' || mediaType === 'video') return mediaType;
  return DOCUMENT_EXTS.has(extensionOf(item.name)) ? 'document' : 'file';
}

function matchesTypeFilter(item, typeFilter) {
  if (typeFilter === 'all') return true;
  if (typeFilter === 'folders') return item.type === 'folder';
  if (typeFilter === 'images') return vaultFilterKind(item) === 'image';
  if (typeFilter === 'videos') return vaultFilterKind(item) === 'video';
  if (typeFilter === 'documents') return vaultFilterKind(item) === 'document';
  if (typeFilter === 'files') return item.type === 'file' && vaultFilterKind(item) === 'file';
  return true;
}

function sortVaultItems(items, sortMode) {
  return [...items].sort((a, b) => {
    if (sortMode === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
    if (sortMode === 'largest') return (b.size || 0) - (a.size || 0);
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
}

function uploadStatusLabel(entry) {
  if (entry.status === 'error') return entry.error || 'Failed';
  if (entry.status === 'done') return 'Done';
  if (entry.status === 'processing') return 'Processing…';
  if (entry.status === 'uploading') return `${entry.percent || 0}%`;
  return 'Waiting…';
}

export default function VaultPage() {
  const toast = useToast();
  const { childrenOf, pathTo, createFolder, uploadFiles, moveItem, deleteItem, getItem, loading, setItemAiHidden } = useVault();
  const [folderId, setFolderId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]); // [{ name, size, percent, status, error }]
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortMode, setSortMode] = useState('name');
  const [dragId, setDragId] = useState(null); // item being dragged
  const [dropTargetId, setDropTargetId] = useState(null); // folder id or 'root' highlighted as a drop target
  const fileInputRef = useRef(null);

  const items = childrenOf(folderId);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const itemMatchesSearch = (item) =>
    !normalizedQuery ||
    String(item.name || '').toLowerCase().includes(normalizedQuery) ||
    String(item.uploadedBy || '').toLowerCase().includes(normalizedQuery);
  const visibleItems = items.filter((item) => itemMatchesSearch(item) && matchesTypeFilter(item, typeFilter));
  const folders = sortVaultItems(
    visibleItems.filter((it) => it.type === 'folder'),
    sortMode,
  );
  const files = sortVaultItems(
    visibleItems.filter((it) => it.type === 'file'),
    sortMode,
  );
  const trail = pathTo(folderId);
  const currentFolderName = trail[trail.length - 1]?.name || 'Main';
  const visibleCount = folders.length + files.length;
  const filtersActive = Boolean(normalizedQuery) || typeFilter !== 'all';

  const handleUpload = async (event) => {
    // Copy the FileList into a real array BEFORE clearing the input. `event.target.files`
    // is live, so resetting value (to allow re-picking the same file) empties it — read
    // it first or the upload silently no-ops with zero files.
    const selected = Array.from(event.target.files || []);
    event.target.value = ''; // allow re-selecting the same file(s)
    if (!selected.length) return;
    setUploadQueue(selected.map((f) => ({ name: f.name, size: f.size, percent: 0, status: 'pending' })));
    setUploading(true);
    try {
      const { uploaded, failed } = await uploadFiles(folderId, selected, (index, patch) => {
        setUploadQueue((cur) => cur.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
      });
      if (failed === 0) {
        toast.success(`Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}`);
      } else if (uploaded === 0) {
        toast.error(`Upload failed for ${failed} file${failed === 1 ? '' : 's'}`);
      } else {
        toast.error(`Uploaded ${uploaded}, but ${failed} failed`);
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setUploading(false);
    }
  };

  // Auto-dismiss the progress dialog shortly after a clean run; keep it open when
  // something failed so the user can see which file(s) and why.
  useEffect(() => {
    if (uploading || !uploadQueue.length) return undefined;
    if (!uploadQueue.every((f) => f.status === 'done')) return undefined;
    const timer = setTimeout(() => setUploadQueue([]), 1000);
    return () => clearTimeout(timer);
  }, [uploading, uploadQueue]);

  const closeUploadDialog = () => {
    if (!uploading) setUploadQueue([]);
  };

  const submitFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      await createFolder(folderId, name);
      toast.success('Folder created');
      setNewFolderName('');
      setNewFolderOpen(false);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setCreatingFolder(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteItem(confirmDelete.id);
      setConfirmDelete(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDeleting(false);
    }
  };

  const toggleAiHidden = async (file) => {
    try {
      const updated = await setItemAiHidden(file.id, !file.aiHidden);
      toast.success(updated.aiHidden ? 'Hidden from the AI agent' : 'Visible to the AI agent');
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const openNewFolder = () => setNewFolderOpen(true);
  const openUploadPicker = () => fileInputRef.current?.click();
  // Up one level: the second-to-last crumb is the parent (none → back to root).
  const goBack = () => setFolderId(trail[trail.length - 2]?.id ?? null);

  // ── Drag-and-drop: drag an item card onto a folder (card or breadcrumb) to move
  // it. The breadcrumb "Main" uses the 'root' key (→ parentId null). ───────────
  const onItemDragStart = (event, item) => {
    setDragId(item.id);
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', item.name || '');
    } catch {
      /* some browsers reject setData before the drag image is ready */
    }
  };
  const onItemDragEnd = () => {
    setDragId(null);
    setDropTargetId(null);
  };
  // A target accepts the drop while something is being dragged that isn't itself.
  const canDropOn = (targetKey) => dragId != null && dragId !== targetKey;
  const onDropZoneOver = (event, targetKey) => {
    if (!canDropOn(targetKey)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== targetKey) setDropTargetId(targetKey);
  };
  const onDropZoneLeave = (event, targetKey) => {
    if (event.currentTarget.contains(event.relatedTarget)) return; // moving within the zone
    setDropTargetId((cur) => (cur === targetKey ? null : cur));
  };
  const onDropZoneDrop = (event, targetKey) => {
    if (!canDropOn(targetKey)) return;
    event.preventDefault();
    const id = dragId;
    setDropTargetId(null);
    setDragId(null);
    doMove(id, targetKey === 'root' ? null : targetKey);
  };
  const doMove = async (id, parentId) => {
    const moving = getItem(id);
    if (!moving || (moving.parentId ?? null) === (parentId ?? null)) return; // gone or already there
    try {
      await moveItem(id, parentId);
      const destName = parentId ? getItem(parentId)?.name || 'folder' : 'Main';
      toast.success(`Moved “${moving.name}” to ${destName}`);
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const clearFilters = () => {
    setSearchQuery('');
    setTypeFilter('all');
  };
  const previewType = preview ? getVaultMediaType(preview) : null;

  return (
    <div className="vault">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Vault</h1>
          <p className="page-head__sub">Shared files and media for everyone on the team.</p>
        </div>
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleUpload} />

      <Card className="vault-panel">
        <section className="vault-browser" aria-label="Vault content">
        <div className="vault-browser__top">
          <nav className="vault__crumbs" aria-label="Folder path">
            <button
              type="button"
              className={`vault__crumb${dropTargetId === 'root' ? ' is-drop-target' : ''}`}
              onClick={() => setFolderId(null)}
              onDragOver={(event) => onDropZoneOver(event, 'root')}
              onDragLeave={(event) => onDropZoneLeave(event, 'root')}
              onDrop={(event) => onDropZoneDrop(event, 'root')}
            >
              Main
            </button>
            {trail.map((folder, i) => {
              const isCurrent = i === trail.length - 1;
              const dropProps = isCurrent
                ? null
                : {
                    onDragOver: (event) => onDropZoneOver(event, folder.id),
                    onDragLeave: (event) => onDropZoneLeave(event, folder.id),
                    onDrop: (event) => onDropZoneDrop(event, folder.id),
                  };
              return (
                <span key={folder.id} className="vault__crumb-wrap">
                  <span className="vault__crumb-sep" aria-hidden="true">/</span>
                  <button
                    type="button"
                    className={`vault__crumb${!isCurrent && dropTargetId === folder.id ? ' is-drop-target' : ''}`}
                    onClick={() => setFolderId(folder.id)}
                    {...dropProps}
                  >
                    {folder.name}
                  </button>
                </span>
              );
            })}
          </nav>
          <div className="vault-browser__actions">
            <Button variant="ghost" size="sm" onClick={openNewFolder}>
              <FolderPlusIcon /> Create a new folder
            </Button>
            <Button size="sm" onClick={openUploadPicker} disabled={uploading}>
              <UploadIcon /> {uploading ? 'Uploading…' : 'Upload files'}
            </Button>
            <span className="vault-browser__count">
              {filtersActive ? `${visibleCount} of ${items.length} shown` : `${items.length} item${items.length === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        <div className="vault-toolbar" aria-label="Vault filters">
          {folderId && (
            <button
              type="button"
              className="vault-back"
              onClick={goBack}
              aria-label="Back to parent folder"
              title="Back"
            >
              <BackIcon />
            </button>
          )}
          <label className="vault-search">
            <span className="vault-search__icon">
              <SearchIcon />
            </span>
            <input
              className="vault-search__input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={`Search ${currentFolderName}`}
              aria-label="Search vault items"
            />
          </label>
          <div className="vault-toolbar__filters">
            <div className="vault-filter">
              <span className="vault-filter__label">Type</span>
              <Dropdown
                className="vault-filter__dropdown"
                value={typeFilter}
                options={TYPE_FILTER_OPTIONS}
                onChange={setTypeFilter}
                ariaLabel="Filter vault items by type"
              />
            </div>
            <div className="vault-filter">
              <span className="vault-filter__label">Sort</span>
              <Dropdown
                className="vault-filter__dropdown"
                value={sortMode}
                options={SORT_OPTIONS}
                onChange={setSortMode}
                ariaLabel="Sort vault items"
              />
            </div>
            {filtersActive && (
              <button type="button" className="vault-toolbar__clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="vault__grid">
        {visibleCount === 0 && (
          <div className="vault__empty">
            {loading ? (
              <Spinner label="Loading files…" />
            ) : (
              <>
                <strong>{filtersActive ? 'No matching items' : 'This folder is empty'}</strong>
                <span>
                  {filtersActive
                    ? 'Try another keyword or adjust the filters.'
                    : 'Use “Upload files” or “Create a new folder” above to add something.'}
                </span>
              </>
            )}
          </div>
        )}
        {folders.map((folder) => (
          <div
            key={folder.id}
            className={`vault-item vault-item--folder${dragId === folder.id ? ' is-dragging' : ''}${
              dropTargetId === folder.id ? ' is-drop-target' : ''
            }`}
            draggable
            onDragStart={(event) => onItemDragStart(event, folder)}
            onDragEnd={onItemDragEnd}
            onDragOver={(event) => onDropZoneOver(event, folder.id)}
            onDragLeave={(event) => onDropZoneLeave(event, folder.id)}
            onDrop={(event) => onDropZoneDrop(event, folder.id)}
          >
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
          <div
            key={file.id}
            className={`vault-item${dragId === file.id ? ' is-dragging' : ''}${file.aiHidden ? ' vault-item--ai-hidden' : ''}`}
            draggable
            onDragStart={(event) => onItemDragStart(event, file)}
            onDragEnd={onItemDragEnd}
          >
            <button
              type="button"
              className="vault-item__open"
              onClick={() => setPreview(file)}
              title={file.name}
            >
              <span className="vault-item__thumb">
                <VaultThumb item={file} />
                {file.aiHidden && <span className="vault-item__ai-badge">Hidden from AI</span>}
              </span>
              <span className="vault-item__name">{file.name}</span>
              <span className="vault-item__meta">{formatBytes(file.size)}</span>
            </button>
            <div className="vault-item__actions">
              <button
                type="button"
                className={`vault-item__act${file.aiHidden ? ' is-active' : ''}`}
                onClick={() => toggleAiHidden(file)}
                aria-label={file.aiHidden ? `Show ${file.name} to the AI` : `Hide ${file.name} from the AI`}
                title={file.aiHidden ? 'Hidden from AI — click to show' : 'Visible to AI — click to hide'}
              >
                {file.aiHidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
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

      </div>
      </Card>

      <Modal
        open={uploadQueue.length > 0}
        title={
          uploading
            ? 'Uploading files'
            : uploadQueue.some((f) => f.status === 'error')
              ? 'Upload finished with errors'
              : 'Upload complete'
        }
        onClose={closeUploadDialog}
        dismissable={!uploading}
        className="modal--upload"
        footer={
          uploading ? null : (
            <Button variant="primary" onClick={closeUploadDialog}>
              Done
            </Button>
          )
        }
      >
        <ul className="vault-upload-list">
          {uploadQueue.map((entry, i) => (
            <li key={i} className={`vault-upload vault-upload--${entry.status}`}>
              <div className="vault-upload__row">
                <span className="vault-upload__name" title={entry.name}>
                  {entry.name}
                </span>
                <span className="vault-upload__status">{uploadStatusLabel(entry)}</span>
              </div>
              <div className="vault-upload__track">
                <div
                  className="vault-upload__bar"
                  style={{ width: `${entry.status === 'done' ? 100 : entry.percent || 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={newFolderOpen}
        title="New folder"
        onClose={() => setNewFolderOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewFolderOpen(false)} disabled={creatingFolder}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!newFolderName.trim() || creatingFolder} onClick={submitFolder}>
              {creatingFolder ? 'Creating…' : 'Create'}
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
            {previewType === 'image' && preview.url ? (
              <img className="vault-preview__media" src={preview.url} alt={preview.name} />
            ) : previewType === 'video' && preview.url ? (
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
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
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
