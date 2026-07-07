import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Spinner, EmptyState } from './ui.jsx';
import * as notesService from '../services/content_notes.service.js';
import { apiError } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';

const fmtDate = (key) => {
  if (!key) return '';
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtClock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

// Local 'YYYY-MM-DD' for today — date keys compare lexicographically.
const todayKey = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const statusLabel = (v) => STATUS_OPTIONS.find((o) => o.value === v)?.label || v;

// Colour swatches offered in the ⋮ → Colour picker. `null` = clear (theme default).
// Note (background) colours are soft fills; text colours are darker so they read
// on both the default and the coloured backgrounds.
const NOTE_COLORS = [null, '#fde68a', '#fed7aa', '#bbf7d0', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#fecaca', '#e2e8f0'];
const TEXT_COLORS = [null, '#0f172a', '#b45309', '#15803d', '#1d4ed8', '#7c3aed', '#be123c', '#64748b', '#ffffff'];

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const EditIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);
const GripIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
    <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
  </svg>
);
const KebabIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
  </svg>
);
const PaletteIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22a10 10 0 1 1 0-20c5.5 0 10 3.8 10 8.5 0 3-2.5 4.5-5 4.5h-2a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22z" />
    <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * Per-day content planner. Opens when `dateKey` ('YYYY-MM-DD') is set; lists that
 * day's notes and lets you add (behind a + button), tag (status chip → picker),
 * edit / delete / inspect (⋮ menu), and drag a note onto another calendar day.
 *
 * Drag coordination lives in the parent (CalendarMonth) — see its props.
 */
export default function DayNotesModal({
  dateKey,
  hidden = false,
  dragging = false,
  refreshToken = 0,
  posts = [],
  onCreatePost,
  onClose,
  onChanged,
  onNoteDragStart,
  onNoteDragEnd,
}) {
  const toast = useToast();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [statusBusyId, setStatusBusyId] = useState(null);
  const [colorBusyId, setColorBusyId] = useState(null);
  // Insertion index (0..notes.length) while dragging a note to reorder within the
  // list — drives the drop-line indicator; null when not reordering.
  const [dragOverIdx, setDragOverIdx] = useState(null);
  // Open popover (status picker, actions menu, or colour picker), fixed-positioned
  // to escape the list's overflow clipping:
  // { note, kind: 'status'|'actions'|'color', left, top?|bottom?, align }.
  const [menu, setMenu] = useState(null);

  // Reordering is applied locally as you drag, then persisted once — on close or
  // when the dialog switches days (see requirement: "applied when the dialog is
  // closed"). Refs let the close/cleanup handlers read the latest values without
  // re-subscribing. `dragNoteRef` is the note being dragged out of THIS list.
  const notesRef = useRef(notes);
  const orderDirtyRef = useRef(false);
  const dragNoteRef = useRef(null);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    if (!dateKey) return undefined;
    let active = true;
    setLoading(true);
    setNotes([]);
    setEditingId(null);
    setComposing(false);
    setDraft('');
    setMenu(null);
    setDragOverIdx(null);
    orderDirtyRef.current = false; // fresh load — no pending reorder for this day
    notesService
      .listByDate(dateKey)
      .then((list) => {
        if (active) setNotes(list);
      })
      .catch((e) => {
        if (active) toast.error(apiError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // On unmount / day-switch, persist any pending reorder for the day we're leaving
    // (this closure still holds that day's dateKey and notesRef).
    return () => {
      active = false;
      flushReorder(dateKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, refreshToken]);

  // Close the popover on Escape (outside clicks are caught by its backdrop).
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu]);

  const notifyChanged = () => onChanged?.(dateKey);
  const closeMenu = () => setMenu(null);
  const isPast = dateKey ? dateKey < todayKey() : false; // can't schedule posts in the past

  // Persist a pending in-list reorder for `dk` (fire-and-forget; refreshes the
  // month chips to the new order). No-op unless the order actually changed.
  const flushReorder = (dk) => {
    if (!orderDirtyRef.current || !dk) return;
    orderDirtyRef.current = false;
    const ids = notesRef.current.map((n) => n.id);
    notesService
      .reorder(dk, ids)
      .then(() => onChanged?.(dk))
      .catch((e) => toast.error(apiError(e)));
  };

  // Closing the dialog commits any pending reorder first (changes apply on close).
  const handleClose = () => {
    flushReorder(dateKey);
    onClose?.();
  };

  const openMenu = (e, note, kind) => {
    const r = e.currentTarget.getBoundingClientRect();
    const nearBottom = r.bottom + 230 > window.innerHeight;
    setMenu({
      note,
      kind,
      align: kind === 'actions' ? 'right' : 'left',
      left: kind === 'actions' ? r.right : r.left,
      ...(nearBottom ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  };

  const addNote = async () => {
    const content = draft.trim();
    if (!content || addBusy) return;
    setAddBusy(true);
    try {
      const note = await notesService.create({ note_date: dateKey, content });
      setNotes((prev) => [...prev, note]);
      setDraft('');
      setComposing(false);
      notifyChanged();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setAddBusy(false);
    }
  };

  const startEdit = (note) => {
    setEditingId(note.id);
    setEditText(note.content);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async (note) => {
    const content = editText.trim();
    if (!content) {
      toast.error('A note can’t be empty.');
      return;
    }
    setBusyId(note.id);
    try {
      const updated = await notesService.update(note.id, { content });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      cancelEdit();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusyId(null);
    }
  };

  const deleteNote = async (note) => {
    if (busyId === note.id) return;
    setBusyId(note.id);
    try {
      await notesService.remove(note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      notifyChanged();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async (note, status) => {
    if (status === note.status || statusBusyId === note.id) return;
    setStatusBusyId(note.id);
    try {
      const updated = await notesService.setStatus(note.id, status);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setStatusBusyId(null);
    }
  };

  // `patch` is { text_color?, note_color? } — an omitted field is left unchanged,
  // null clears it back to the theme default. Persists immediately.
  const changeColor = async (note, patch) => {
    setColorBusyId(note.id);
    try {
      const updated = await notesService.setColor(note.id, patch);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      notifyChanged(); // month chips mirror the note colour
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setColorBusyId(null);
    }
  };

  // Move the dragged note to `targetIdx` (an insertion index in 0..len) within the
  // day. Local only — the new order is saved when the dialog closes.
  const reorderLocal = (dragId, targetIdx) => {
    setNotes((prev) => {
      const from = prev.findIndex((n) => n.id === dragId);
      if (from < 0) return prev;
      const arr = prev.slice();
      const [moved] = arr.splice(from, 1);
      let to = targetIdx;
      if (from < to) to -= 1; // account for the item we just removed
      to = Math.max(0, Math.min(arr.length, to));
      arr.splice(to, 0, moved);
      const changed = arr.some((n, i) => n.id !== prev[i].id);
      if (changed) orderDirtyRef.current = true;
      return changed ? arr : prev;
    });
  };

  const onItemDragStart = (e, note) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(note.id)); // Firefox needs payload to start a drag
    dragNoteRef.current = note; // this list owns the drag → enables in-list reorder
    const card = e.currentTarget.closest('.day-note');
    if (card) {
      try {
        e.dataTransfer.setDragImage(card, 16, 16);
      } catch {
        /* setDragImage unsupported — fall back to the default grip image */
      }
    }
    // Defer flipping parent state. That re-renders the drag source's overlay —
    // doing it *synchronously during* dragstart makes Chrome cancel the drag
    // (dragend fires immediately). A 0ms timeout lets the browser establish the
    // drag first. `notes.length` tells the parent whether this is the day's last
    // note (so a cross-day move can re-open the destination day).
    setTimeout(() => onNoteDragStart?.(note, notes.length), 0);
  };

  const onItemDragEnd = () => {
    dragNoteRef.current = null;
    setDragOverIdx(null);
    onNoteDragEnd?.();
  };

  // Drop within the list → reorder to the current insertion index (default: end).
  const onListDrop = (e) => {
    const dragged = dragNoteRef.current;
    if (!dragged) return;
    e.preventDefault();
    const idx = dragOverIdx == null ? notesRef.current.length : dragOverIdx;
    setDragOverIdx(null);
    reorderLocal(dragged.id, idx);
  };

  return (
    <Modal
      open={!!dateKey}
      title={fmtDate(dateKey)}
      onClose={handleClose}
      className="modal--notes"
      hidden={hidden}
      dragThrough={dragging}
    >
      {loading ? (
        <Spinner label="Loading notes…" />
      ) : (
        <div className="day-notes">
          <div className="day-notes__top">
            {composing ? (
              <div className="day-notes__compose">
                <textarea
                  className="textarea"
                  placeholder="Add a content note for this day…  (⌘/Ctrl + Enter to save)"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      addNote();
                    }
                  }}
                />
                <div className="day-notes__add-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setComposing(false);
                      setDraft('');
                    }}
                    disabled={addBusy}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={addNote} disabled={!draft.trim() || addBusy}>
                    {addBusy ? 'Adding…' : 'Add note'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="day-notes__buttons">
                <button type="button" className="day-notes__addbtn" onClick={() => setComposing(true)}>
                  <PlusIcon /> Add note
                </button>
                {!isPast && (
                  <button
                    type="button"
                    className="day-notes__addbtn day-notes__addbtn--post"
                    onClick={() => onCreatePost?.(dateKey)}
                  >
                    <PlusIcon /> Create Post
                  </button>
                )}
              </div>
            )}
          </div>

          {posts.length > 0 && (
            <div className="day-posts">
              <div className="day-section__label">Scheduled posts ({posts.length})</div>
              <ul className="day-posts__list">
                {posts.map((p) => (
                  <li key={p.id} className="day-post">
                    {p.thumbnail_preview_url ? (
                      // Optimized still — avoids fetching the full clip for a row.
                      <img className="day-post__thumb" src={p.thumbnail_preview_url} alt="" />
                    ) : p.media_preview_url ? (
                      p.media_type === 'video' ? (
                        <video className="day-post__thumb" src={p.media_preview_url} muted preload="metadata" />
                      ) : (
                        <img className="day-post__thumb" src={p.media_preview_url} alt="" />
                      )
                    ) : (
                      <span className="day-post__icon" aria-hidden="true">
                        {p.media_type === 'video' ? '🎬' : p.media_type === 'image' ? '🖼️' : '📝'}
                      </span>
                    )}
                    <div className="day-post__main">
                      <div className="day-post__caption">{p.caption || '(no caption)'}</div>
                      <div className="day-post__meta">
                        {fmtClock(p.scheduled_at)}
                        {p.status ? ` · ${p.status}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notes.length === 0 && posts.length === 0 ? (
            <EmptyState
              icon="🗓️"
              title="No plans yet"
              message="Use “Add note” to plan, or “Create Post” to schedule content for this day."
            />
          ) : notes.length > 0 ? (
            <>
              <div className="day-section__label">Notes ({notes.length})</div>
              <ul
                className="day-notes__list"
                onDragOver={(e) => {
                  // Allow dropping anywhere over the list (reorder); precise index
                  // comes from the per-item handlers below.
                  if (!dragNoteRef.current) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={onListDrop}
              >
                {notes.map((note, idx) => {
                  const last = idx === notes.length - 1;
                  const cls = [
                    'day-note',
                    dragOverIdx === idx && 'is-drop-before',
                    last && dragOverIdx === notes.length && 'is-drop-after',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                  <li
                    key={note.id}
                    className={cls}
                    style={note.note_color ? { background: note.note_color, borderColor: note.note_color } : undefined}
                    onDragOver={(e) => {
                      if (!dragNoteRef.current || editingId === note.id) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < r.top + r.height / 2;
                      setDragOverIdx(before ? idx : idx + 1);
                    }}>
                    {editingId === note.id ? (
                      <div className="day-note__edit">
                        <textarea
                          className="textarea"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                        <div className="day-note__actions day-note__actions--end">
                          <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={busyId === note.id}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => saveEdit(note)} disabled={busyId === note.id}>
                            {busyId === note.id ? 'Saving…' : 'Save'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="day-note__row">
                        <span
                          className="day-note__grip"
                          draggable
                          title="Drag to reorder, or onto a calendar day to move this note"
                          aria-label="Drag to reorder or move this note"
                          onDragStart={(e) => onItemDragStart(e, note)}
                          onDragEnd={onItemDragEnd}
                        >
                          <GripIcon />
                        </span>
                        <div className="day-note__main">
                          <div className="day-note__body" style={note.text_color ? { color: note.text_color } : undefined}>
                            {note.content}
                          </div>
                        </div>
                        <div className="day-note__actions">
                          <button
                            type="button"
                            className="status-chip"
                            onClick={(e) => openMenu(e, note, 'status')}
                            disabled={statusBusyId === note.id}
                            aria-label={`Status: ${statusLabel(note.status)} — change`}
                          >
                            <span className={`status-dot status-dot--${note.status}`} />
                            <span className="status-chip__label">{statusLabel(note.status)}</span>
                          </button>
                          <button
                            type="button"
                            className="card-iconbtn"
                            title="Options"
                            aria-label="Note options"
                            onClick={(e) => openMenu(e, note, 'actions')}
                            disabled={busyId === note.id}
                          >
                            <KebabIcon />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
              <div className="day-notes__hint">
                Tip: drag a note by its handle to reorder the list, or onto another calendar day to move it.
              </div>
            </>
          ) : null}
        </div>
      )}

      {menu && (
        <>
          <div className="note-menu-backdrop" onClick={closeMenu} />
          <div
            className={`note-menu note-menu--${menu.align}`}
            role="menu"
            style={{ left: menu.left, ...(menu.bottom != null ? { bottom: menu.bottom } : { top: menu.top }) }}
          >
            {menu.kind === 'status' ? (
              STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  className="note-menu__item"
                  onClick={() => {
                    const n = menu.note;
                    closeMenu();
                    changeStatus(n, o.value);
                  }}
                >
                  <span className={`status-dot status-dot--${o.value}`} />
                  <span className="note-menu__label">{o.label}</span>
                  {menu.note.status === o.value && <span className="note-menu__check" aria-hidden="true">✓</span>}
                </button>
              ))
            ) : menu.kind === 'color' ? (
              (() => {
                // Always reflect the note's live colours (it may have changed while
                // the picker stayed open), so the active ring tracks each pick.
                const active = notes.find((n) => n.id === menu.note.id) || menu.note;
                const busy = colorBusyId === active.id;
                const swatchRow = (palette, current, field) =>
                  palette.map((c) => {
                    const on = (current || null) === c;
                    return (
                      <button
                        key={`${field}-${c || 'default'}`}
                        type="button"
                        className={`swatch${c ? '' : ' swatch--none'}${on ? ' is-active' : ''}`}
                        style={c ? { background: c } : undefined}
                        disabled={busy}
                        title={c || 'Default'}
                        aria-label={`${field === 'note_color' ? 'Note' : 'Text'} colour ${c || 'default'}`}
                        onClick={() => changeColor(active, { [field]: c })}
                      >
                        {on && <span className="swatch__check" aria-hidden="true">✓</span>}
                      </button>
                    );
                  });
                return (
                  <div className="note-colors">
                    <button
                      type="button"
                      className="note-menu__item note-menu__back"
                      onClick={() => setMenu((m) => (m ? { ...m, kind: 'actions' } : m))}
                    >
                      <span aria-hidden="true">‹</span>
                      <span className="note-menu__label">Back</span>
                    </button>
                    <div className="note-colors__label">Note colour</div>
                    <div className="note-colors__row">{swatchRow(NOTE_COLORS, active.note_color, 'note_color')}</div>
                    <div className="note-colors__label">Text colour</div>
                    <div className="note-colors__row">{swatchRow(TEXT_COLORS, active.text_color, 'text_color')}</div>
                  </div>
                );
              })()
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu__item"
                  onClick={() => {
                    const n = menu.note;
                    closeMenu();
                    startEdit(n);
                  }}
                >
                  <EditIcon />
                  <span className="note-menu__label">Edit</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu__item"
                  onClick={() => setMenu((m) => (m ? { ...m, kind: 'color' } : m))}
                >
                  <PaletteIcon />
                  <span className="note-menu__label">Colour</span>
                  <span aria-hidden="true">›</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu__item note-menu__item--danger"
                  onClick={() => {
                    const n = menu.note;
                    closeMenu();
                    deleteNote(n);
                  }}
                >
                  <TrashIcon />
                  <span className="note-menu__label">Delete</span>
                </button>
                <div className="note-menu__sep" />
                <div className="note-menu__meta">
                  <div>
                    Added by <strong>{menu.note.user_name || 'Unknown'}</strong>
                  </div>
                  <div>Created {fmtTime(menu.note.created_at)}</div>
                  {menu.note.updated_at && menu.note.updated_at !== menu.note.created_at && (
                    <div>Updated {fmtTime(menu.note.updated_at)}</div>
                  )}
                  <div>
                    Status <span className="note-menu__meta-status">{statusLabel(menu.note.status)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
