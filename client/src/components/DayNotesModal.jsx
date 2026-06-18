import { useEffect, useState } from 'react';
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
  // Open popover (status picker or actions menu), fixed-positioned to escape the
  // list's overflow clipping: { note, kind: 'status'|'actions', left, top?|bottom?, align }.
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    if (!dateKey) return undefined;
    let active = true;
    setLoading(true);
    setNotes([]);
    setEditingId(null);
    setComposing(false);
    setDraft('');
    setMenu(null);
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
    return () => {
      active = false;
    };
  }, [dateKey, refreshToken, toast]);

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

  const onItemDragStart = (e, note) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(note.id)); // Firefox needs payload to start a drag
    const card = e.currentTarget.closest('.day-note');
    if (card) {
      try {
        e.dataTransfer.setDragImage(card, 16, 16);
      } catch {
        /* setDragImage unsupported — fall back to the default grip image */
      }
    }
    // Defer hiding the dialog. This flips parent state, which re-renders the drag
    // source's overlay — doing that *synchronously during* dragstart makes Chrome
    // cancel the drag (dragend fires immediately, so nothing hides/highlights). A
    // 0ms timeout lets the browser finish establishing the drag first.
    setTimeout(() => onNoteDragStart?.(note), 0);
  };

  return (
    <Modal open={!!dateKey} title={fmtDate(dateKey)} onClose={onClose} className="modal--notes" hidden={hidden}>
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
              <ul className="day-notes__list">
                {notes.map((note) => (
                  <li key={note.id} className="day-note">
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
                          title="Drag onto a calendar day to move this note"
                          aria-label="Drag note to another day"
                          onDragStart={(e) => onItemDragStart(e, note)}
                          onDragEnd={() => onNoteDragEnd?.()}
                        >
                          <GripIcon />
                        </span>
                        <div className="day-note__main">
                          <div className="day-note__body">{note.content}</div>
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
                ))}
              </ul>
              <div className="day-notes__hint">Tip: drag a note by its handle onto another calendar day to move it.</div>
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
