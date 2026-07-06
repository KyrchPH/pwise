import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, Dropdown, Modal, Spinner, Toggle } from '../../components/ui.jsx';
import { VaultThumb } from '../../components/VaultThumb.jsx';
import { downloadVaultItem, formatBytes, getVaultMediaType, useVault } from '../../context/VaultContext.jsx';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import * as connectionsApi from '../../services/connections.service.js';

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

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
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

function KebabIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

// Padlock — the "Manage access" action + the private-folder name badge.
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Small × for removing a selected-user chip.
function ChipRemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

// Token/tag input for a private folder's allow-list. Admins are omitted — they always
// have access — so this is purely "which other users may see this folder". Typing filters
// the team into a suggestion dropdown; picking one adds a removable chip inside the field.
// Props are unchanged (users, selected, onToggle) so both the create + manage-access
// modals reuse it; `selected` is a list of string ids, `onToggle(id)` adds/removes one.
function UserPicker({ users, selected, onToggle }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const fieldRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);

  // Admins always have access; inactive/deleted users can't sign in — omit all three.
  const pickable = users; // sourced from the admin's connections (already active & non-admin)
  const byId = new Map(users.map((u) => [String(u.id), u]));

  // Chips render from the current selection (resolve id → record for the label).
  const chosen = selected.map((id) => byId.get(String(id))).filter(Boolean);

  // Suggestions: pickable users not already chosen, matched against the typed query.
  const q = query.trim().toLowerCase();
  const suggestions = pickable.filter((u) => {
    if (selected.includes(String(u.id))) return false;
    if (!q) return true;
    return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
  });

  // The dropdown is portaled to <body> and fixed-positioned from the field's rect, so
  // the modal's scrollable body can't clip it (the same trick CardMenu uses).
  const place = useCallback(() => {
    const r = fieldRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }, []);

  // While open: keep the menu glued to the field, and close on an outside click. A
  // click inside the portaled menu counts as inside — check menuRef too.
  useEffect(() => {
    if (!open) return undefined;
    place();
    const onDown = (event) => {
      if (!wrapRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture: the modal body scrolls too
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Reposition when chips are added/removed (the field can grow a row and shift down).
  useEffect(() => {
    if (open) place();
  }, [open, selected.length, place]);

  // Reset the highlighted suggestion whenever the query changes the list.
  useEffect(() => setActive(0), [query]);

  const add = (u) => {
    onToggle(String(u.id));
    setQuery('');
    setActive(0);
    setOpen(true); // keep the menu open to add several in a row
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && open && suggestions[active]) {
      event.preventDefault();
      add(suggestions[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Backspace' && !query && chosen.length) {
      // Backspace on an empty field pops the last chip.
      onToggle(String(chosen[chosen.length - 1].id));
    }
  };

  return (
    <div className="vault-access__users" role="group" aria-label="Users with access">
      <p className="vault-access__hint">Admins always have access. Add people from your connections who can also see this folder:</p>
      {pickable.length === 0 ? (
        <p className="vault-access__empty">You have no connections yet — connect with teammates to share private folders with them.</p>
      ) : (
        <div className="vault-tokens" ref={wrapRef}>
          <div
            ref={fieldRef}
            className={`vault-tokens__field${open ? ' is-open' : ''}`}
            onClick={() => {
              inputRef.current?.focus();
              setOpen(true);
            }}
          >
            {chosen.map((u) => (
              <span key={u.id} className="vault-token">
                <span className="vault-token__label">{u.name || u.email}</span>
                <button
                  type="button"
                  className="vault-token__remove"
                  aria-label={`Remove ${u.name || u.email}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(String(u.id));
                  }}
                >
                  <ChipRemoveIcon />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              className="vault-tokens__input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={chosen.length ? '' : 'Type a name or email…'}
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
            />
          </div>
          {open &&
            menuPos &&
            createPortal(
              <ul
                ref={menuRef}
                className="vault-tokens__menu"
                role="listbox"
                style={{ position: 'fixed', left: menuPos.left, top: menuPos.top, width: menuPos.width }}
                onMouseDown={(event) => event.preventDefault()} // keep the input focused on click
              >
                {suggestions.length === 0 ? (
                  <li className="vault-tokens__empty">{q ? 'No matching connections.' : 'No more connections to add.'}</li>
                ) : (
                  suggestions.map((u, i) => (
                    <li
                      key={u.id}
                      role="option"
                      aria-selected={i === active}
                      className={`vault-tokens__opt${i === active ? ' is-active' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => add(u)}
                    >
                      <span className="vault-access__user-name">{u.name || u.email}</span>
                      {u.name && <span className="vault-access__user-email">{u.email}</span>}
                    </li>
                  ))
                )}
              </ul>,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}

// Add/remove an id from a selection list (immutable).
const toggleId = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// One row in a card's kebab menu: icon + label, with an optional second line of
// helper text (used to explain the AI-access toggle).
function MenuItem({ icon, label, desc, danger = false, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`vault-menu__item${danger ? ' vault-menu__item--danger' : ''}`}
      onClick={onClick}
    >
      <span className="vault-menu__item-icon">{icon}</span>
      <span className="vault-menu__item-body">
        <span className="vault-menu__item-label">{label}</span>
        {desc && <span className="vault-menu__item-desc">{desc}</span>}
      </span>
    </button>
  );
}

// Kebab (⋮) actions menu for a vault card. The list is portaled to <body> and
// fixed-positioned from the trigger's rect — the card has overflow:hidden AND a
// hover transform, either of which would otherwise clip/contain an in-card popover.
function CardMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = 250; // approx — only used to flip upward near the viewport bottom
    const below = window.innerHeight - r.bottom;
    const top = below < menuH && r.top > below ? Math.max(8, r.top - menuH - 6) : r.bottom + 6;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  };

  const toggle = () => {
    if (!open) place();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // The list is fixed-positioned, so a scroll/resize would detach it — just close.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <div className="vault-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`vault-item__act vault-menu__trigger${open ? ' is-active' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title="Actions"
      >
        <KebabIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="vault-menu__list"
            role="menu"
            style={{ top: pos.top, right: pos.right }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
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
  const { childrenOf, pathTo, createFolder, uploadFiles, moveItem, deleteItem, getItem, loading, setItemAiHidden, setItemMeta, setFolderAccess, getFolderAccess } = useVault();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [folderId, setFolderId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderPrivate, setNewFolderPrivate] = useState(false); // admin: restrict the new folder
  const [newFolderUserIds, setNewFolderUserIds] = useState([]); // admin: allow-list for a private new folder
  const [users, setUsers] = useState([]); // team users for the access pickers (admins only)
  const [accessFolder, setAccessFolder] = useState(null); // folder whose "Manage access" modal is open
  const [accessDraft, setAccessDraft] = useState({ visibility: 'public', userIds: [] });
  const [accessBusy, setAccessBusy] = useState(false); // loading/saving the access modal
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]); // [{ name, size, percent, status, error }]
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortMode, setSortMode] = useState('name');
  const [dragId, setDragId] = useState(null); // item being dragged
  const [dropTargetId, setDropTargetId] = useState(null); // folder id or 'root' highlighted as a drop target
  const [editMetaId, setEditMetaId] = useState(null); // file whose Details panel is open
  const [metaDraft, setMetaDraft] = useState({ description: '', tags: '' });
  const [savingMeta, setSavingMeta] = useState(false);
  const [dragActive, setDragActive] = useState(false); // OS files being dragged over the window
  const fileInputRef = useRef(null);
  const startUploadRef = useRef(null); // latest uploader so the window listeners hit the current folder
  const uploadingRef = useRef(false);

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

  // Core uploader — shared by the file picker and OS drag-and-drop. Uploads into
  // the folder currently being viewed.
  const startUpload = async (fileList) => {
    const selected = Array.from(fileList || []);
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

  const handleUpload = (event) => {
    // Copy the FileList into a real array BEFORE clearing the input — `event.target.files`
    // is live, so resetting value (to allow re-picking the same file) empties it.
    const selected = Array.from(event.target.files || []);
    event.target.value = ''; // allow re-selecting the same file(s)
    startUpload(selected);
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

  // Keep the once-bound window listeners (below) pointed at the latest uploader +
  // uploading flag, without re-binding them on every render / folder change.
  useEffect(() => {
    startUploadRef.current = startUpload;
    uploadingRef.current = uploading;
  });

  // Drag OS files anywhere over the Vault → a full-screen drop zone appears, and
  // dropping uploads them into the current folder. Gated on a real file drag
  // ('Files' in dataTransfer.types) so the internal item-move drag (which carries
  // 'text/plain') never triggers it. A short timer hides the overlay if the drag
  // ends off-window without a drop; edge-leave hides it immediately.
  useEffect(() => {
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    let hideTimer;
    const show = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // always — marks the window a valid drop target so the browser won't open the file
      if (e.dataTransfer) e.dataTransfer.dropEffect = uploadingRef.current ? 'none' : 'copy';
      if (uploadingRef.current) return; // an upload is already running — swallow the drag but don't overlay
      setDragActive(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setDragActive(false), 600);
    };
    const onLeave = (e) => {
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        clearTimeout(hideTimer);
        setDragActive(false);
      }
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // stop the browser from navigating to / opening the file
      clearTimeout(hideTimer);
      setDragActive(false);
      if (!uploadingRef.current && e.dataTransfer?.files?.length) startUploadRef.current(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', show);
    window.addEventListener('dragover', show);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('dragenter', show);
      window.removeEventListener('dragover', show);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Suggestions for a private folder's allow-list come from the admin's CONNECTIONS
  // (accepted agent-to-agent "friends"), not the whole team.
  const loadConnections = async () => {
    if (!isAdmin || users.length) return;
    try {
      const { connections } = await connectionsApi.list();
      setUsers(connections || []);
    } catch {
      /* non-fatal — the picker just shows empty */
    }
  };

  const submitFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const options = isAdmin && newFolderPrivate ? { visibility: 'private', accessUserIds: newFolderUserIds } : {};
      await createFolder(folderId, name, options);
      toast.success('Folder created');
      setNewFolderName('');
      setNewFolderPrivate(false);
      setNewFolderUserIds([]);
      setNewFolderOpen(false);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setCreatingFolder(false);
    }
  };

  // Admin: open a folder's access manager, loading the user list + its current config.
  const openManageAccess = async (folder) => {
    setAccessFolder(folder);
    setAccessDraft({ visibility: folder.visibility || 'public', userIds: [] });
    setAccessBusy(true);
    try {
      await loadConnections();
      const cfg = await getFolderAccess(folder.id);
      // Merge already-granted users (who may no longer be connections) so their chips
      // resolve; the typeahead suggestions still only offer connections.
      if (cfg.users?.length) {
        setUsers((cur) => {
          const seen = new Set(cur.map((u) => String(u.id)));
          return [...cur, ...cfg.users.filter((u) => !seen.has(String(u.id)))];
        });
      }
      setAccessDraft({ visibility: cfg.visibility || 'public', userIds: cfg.userIds || [] });
    } catch (e) {
      toast.error(apiError(e));
      setAccessFolder(null);
    } finally {
      setAccessBusy(false);
    }
  };

  const saveAccess = async () => {
    if (!accessFolder || accessBusy) return;
    setAccessBusy(true);
    try {
      await setFolderAccess(accessFolder.id, {
        visibility: accessDraft.visibility,
        userIds: accessDraft.visibility === 'private' ? accessDraft.userIds : [],
      });
      toast.success(accessDraft.visibility === 'private' ? 'Folder is now private' : 'Folder is now public');
      setAccessFolder(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setAccessBusy(false);
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

  const openDetails = (file) => {
    setEditMetaId(file.id);
    setMetaDraft({
      description: file.description || '',
      tags: Array.isArray(file.tags) ? file.tags.join(', ') : '',
    });
  };

  const saveMeta = async () => {
    if (!editMetaId || savingMeta) return;
    setSavingMeta(true);
    try {
      await setItemMeta(editMetaId, { description: metaDraft.description, tags: metaDraft.tags });
      toast.success('Details saved');
      setEditMetaId(null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSavingMeta(false);
    }
  };

  const openNewFolder = () => {
    setNewFolderName('');
    setNewFolderPrivate(false);
    setNewFolderUserIds([]);
    if (isAdmin) loadConnections();
    setNewFolderOpen(true);
  };
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
  const editMetaItem = editMetaId ? getItem(editMetaId) : null; // live (reflects AI-flag toggles)

  return (
    <div className="vault">
      {dragActive && (
        <div className="vault-dropzone" aria-hidden="true">
          <div className="vault-dropzone__inner">
            <svg
              className="vault-dropzone__icon"
              viewBox="0 0 24 24"
              width="46"
              height="46"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Drop here to upload files</span>
          </div>
        </div>
      )}
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
        {folders.map((folder) => {
          const isPrivate = folder.visibility === 'private';
          return (
          <div
            key={folder.id}
            className={`vault-item vault-item--folder${isPrivate ? ' vault-item--private' : ''}${dragId === folder.id ? ' is-dragging' : ''}${
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
              <span className="vault-item__name">
                {isPrivate && (
                  <span className="vault-item__lock" title="Private folder">
                    <LockIcon />
                  </span>
                )}
                {folder.name}
              </span>
              <span className="vault-item__meta">
                {childrenOf(folder.id).length} items{isPrivate ? ' · Private' : ''}
              </span>
            </button>
            <CardMenu label={`Actions for ${folder.name}`}>
              {isAdmin && (
                <MenuItem
                  icon={<LockIcon />}
                  label="Manage access"
                  desc={isPrivate ? 'Private — only chosen users can see it.' : 'Public — everyone can see it.'}
                  onClick={() => openManageAccess(folder)}
                />
              )}
              <MenuItem icon={<TrashIcon />} label="Delete" danger onClick={() => setConfirmDelete(folder)} />
            </CardMenu>
          </div>
          );
        })}
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
            <CardMenu label={`Actions for ${file.name}`}>
              <MenuItem
                icon={<TagIcon />}
                label="Details, description & tags"
                onClick={() => openDetails(file)}
              />
              <MenuItem
                icon={file.aiHidden ? <EyeOffIcon /> : <EyeIcon />}
                label={file.aiHidden ? 'Hidden from AI' : 'Visible to AI'}
                desc={
                  file.aiHidden
                    ? "The AI agent won't send this file to customers."
                    : 'The AI agent may send this file to customers.'
                }
                onClick={() => toggleAiHidden(file)}
              />
              <MenuItem icon={<DownloadIcon />} label="Download" onClick={() => downloadVaultItem(file)} />
              <MenuItem icon={<TrashIcon />} label="Delete" danger onClick={() => setConfirmDelete(file)} />
            </CardMenu>
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
        {isAdmin && (
          <div className="vault-access">
            <div className="vault-access__toggle">
              <div>
                <span className="field__label" style={{ display: 'block', marginBottom: 2 }}>
                  Private folder
                </span>
                <span className="text-sm text-muted">Only admins and the users you choose can see it.</span>
              </div>
              <Toggle checked={newFolderPrivate} onChange={setNewFolderPrivate} />
            </div>
            {newFolderPrivate && (
              <UserPicker
                users={users}
                selected={newFolderUserIds}
                onToggle={(id) => setNewFolderUserIds((cur) => toggleId(cur, id))}
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!accessFolder}
        title={accessFolder ? `Access — ${accessFolder.name}` : 'Folder access'}
        onClose={() => !accessBusy && setAccessFolder(null)}
        className="modal--vaultaccess"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAccessFolder(null)} disabled={accessBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveAccess} disabled={accessBusy}>
              {accessBusy ? 'Saving…' : 'Save access'}
            </Button>
          </>
        }
      >
        {accessFolder && (
          <div className="vault-access">
            <div className="vault-access__toggle">
              <div>
                <span className="field__label" style={{ display: 'block', marginBottom: 2 }}>
                  Private folder
                </span>
                <span className="text-sm text-muted">
                  {accessDraft.visibility === 'private'
                    ? 'Only admins and the chosen users can see and open this folder.'
                    : 'Public — everyone on the team can see this folder.'}
                </span>
              </div>
              <Toggle
                checked={accessDraft.visibility === 'private'}
                onChange={(on) => setAccessDraft((d) => ({ ...d, visibility: on ? 'private' : 'public' }))}
              />
            </div>
            {accessDraft.visibility === 'private' && (
              <UserPicker
                users={users}
                selected={accessDraft.userIds}
                onToggle={(id) => setAccessDraft((d) => ({ ...d, userIds: toggleId(d.userIds, id) }))}
              />
            )}
          </div>
        )}
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
            {preview.description && <p className="vault-preview__desc">{preview.description}</p>}
            {preview.tags?.length > 0 && (
              <div className="vault-preview__tags">
                {preview.tags.map((tag) => (
                  <span key={tag} className="vault-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!editMetaItem}
        title={editMetaItem ? `Details — ${editMetaItem.name}` : 'Details'}
        onClose={() => setEditMetaId(null)}
        className="modal--vaultdetails"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditMetaId(null)} disabled={savingMeta}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveMeta} disabled={savingMeta}>
              {savingMeta ? 'Saving…' : 'Save details'}
            </Button>
          </>
        }
      >
        {editMetaItem && (
          <div className="vault-details">
            <label className="vault-details__field">
              <span className="vault-details__label">Description</span>
              <textarea
                className="input vault-details__textarea"
                rows={3}
                value={metaDraft.description}
                onChange={(event) => setMetaDraft((d) => ({ ...d, description: event.target.value }))}
                placeholder="What is this file? The AI uses this to pick media for customers."
              />
            </label>
            <label className="vault-details__field">
              <span className="vault-details__label">Tags</span>
              <input
                className="input"
                value={metaDraft.tags}
                onChange={(event) => setMetaDraft((d) => ({ ...d, tags: event.target.value }))}
                placeholder="mop, promo, summer"
              />
              <span className="vault-details__hint">
                Separate with commas. Tags rank highest when the AI matches media to a customer’s words.
              </span>
            </label>
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
