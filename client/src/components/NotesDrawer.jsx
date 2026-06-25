import { useEffect, useRef, useState } from 'react';
import { renderNoteText, formatNoteTime } from '../pages/Messaging/notesText.jsx';

const MAX_BODY = 5000;

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

// A note is "long" enough to be worth a Show more / Show less toggle when it has a
// lot of text or several lines (the card otherwise clamps to a few lines).
function isLongNote(body) {
  return body.length > 160 || (body.match(/\n/g)?.length || 0) >= 4;
}

/**
 * Floating sticky note — pinned to the top-right of the conversation view, below the
 * header. Shows the most recent note (author, time, first 3 lines via CSS clamp) with
 * prev/next to step through history and an expand button that opens the full drawer.
 */
export function NoteSticky({ notes = [], index = 0, onIndex, onOpen }) {
  if (!notes.length) return null;
  const idx = Math.min(Math.max(index, 0), notes.length - 1);
  const note = notes[idx];
  return (
    <div className="note-sticky" role="note" aria-label="Conversation note">
      <div className="note-sticky__top">
        <span className="note-sticky__author" title={note.createdByName}>
          {note.createdByName || 'Unknown'}
        </span>
        <div className="note-sticky__actions">
          {notes.length > 1 && (
            <>
              <button
                type="button"
                className="note-sticky__navbtn"
                onClick={() => onIndex(idx - 1)}
                disabled={idx === 0}
                aria-label="Newer note"
              >
                <Chevron dir="left" />
              </button>
              <span className="note-sticky__count">{idx + 1}/{notes.length}</span>
              <button
                type="button"
                className="note-sticky__navbtn"
                onClick={() => onIndex(idx + 1)}
                disabled={idx === notes.length - 1}
                aria-label="Older note"
              >
                <Chevron dir="right" />
              </button>
            </>
          )}
          <button type="button" className="note-sticky__expand" onClick={onOpen} title="Open all notes" aria-label="Open all notes">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 3 3 3 3 9" />
              <polyline points="15 21 21 21 21 15" />
              <line x1="3" y1="3" x2="10" y2="10" />
              <line x1="21" y1="21" x2="14" y2="14" />
            </svg>
          </button>
        </div>
      </div>
      <div className="note-sticky__time">{formatNoteTime(note.createdAt)}</div>
      <div className="note-sticky__body">{renderNoteText(note.body)}</div>
    </div>
  );
}

/**
 * Notes Drawer — right-side panel opened from the conversation header's Notes button.
 * Lists a thread's notes (newest first), each expandable to full text. Any messaging
 * user can add one via the composer; notes can't be edited, and only admins see a
 * delete control (the server enforces it regardless).
 */
export default function NotesDrawer({ open, onClose, notes = [], onCreate, onDelete, onMessageAuthor, canDelete = false, creating = false, currentUserId = null }) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [deletingId, setDeletingId] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const toggle = (id) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    const body = draft.trim();
    if (!body || creating) return;
    try {
      await onCreate(body);
      setDraft('');
      textareaRef.current?.focus();
    } catch {
      /* parent surfaces the error toast */
    }
  };

  const handleDelete = async (id) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <aside className={`tmpl-drawer notes-drawer${open ? ' is-open' : ''}`} aria-hidden={!open} aria-label="Conversation notes">
      <div className="tmpl-drawer__head">
        <div className="tmpl-drawer__heading">
          <span className="tmpl-drawer__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16v11l-5 5H4z" />
              <path d="M15 20v-5h5" />
            </svg>
          </span>
          <div>
            <h2 className="tmpl-drawer__title">Notes</h2>
            <p className="tmpl-drawer__sub">Context about this customer. Notes can&apos;t be edited once saved.</p>
          </div>
        </div>
        <button type="button" className="tmpl-drawer__close" onClick={onClose} aria-label="Close notes">
          <CloseIcon />
        </button>
      </div>

      <div className="notes-drawer__composer">
        <textarea
          ref={textareaRef}
          className="notes-drawer__input"
          value={draft}
          maxLength={MAX_BODY}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
          }}
          placeholder="Add a note about what happened… (links allowed, no images)"
          aria-label="New note"
          rows={3}
        />
        <div className="notes-drawer__composer-actions">
          <span className="notes-drawer__hint">Ctrl/⌘ + Enter to save</span>
          <button type="button" className="notes-drawer__add" onClick={submit} disabled={!draft.trim() || creating}>
            {creating ? 'Adding…' : 'Add note'}
          </button>
        </div>
      </div>

      <div className="tmpl-drawer__list notes-drawer__list">
        {notes.length === 0 ? (
          <p className="tmpl-drawer__empty">No notes yet. Add the first one above.</p>
        ) : (
          notes.map((note) => {
            const long = isLongNote(note.body || '');
            const isOpen = expanded.has(note.id);
            return (
              <article key={note.id} className="note-card">
                <div className="note-card__top">
                  <div className="note-card__meta">
                    <span className="note-card__author">{note.createdByName || 'Unknown'}</span>
                    <span className="note-card__time">{formatNoteTime(note.createdAt)}</span>
                  </div>
                  <div className="note-card__actions">
                    {note.createdBy != null && Number(note.createdBy) !== Number(currentUserId) && (
                      <button
                        type="button"
                        className="note-card__msg"
                        onClick={() => onMessageAuthor?.(note)}
                        title={`Message ${note.createdByName || 'this agent'}`}
                        aria-label={`Message ${note.createdByName || 'this agent'}`}
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
                        </svg>
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="note-card__del"
                        onClick={() => handleDelete(note.id)}
                        disabled={deletingId === note.id}
                        title="Delete note"
                        aria-label="Delete note"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </div>
                <div className={`note-card__body${long && !isOpen ? ' is-clamped' : ''}`}>
                  {renderNoteText(note.body)}
                </div>
                {long && (
                  <button type="button" className="note-card__toggle" onClick={() => toggle(note.id)}>
                    {isOpen ? 'Show less' : 'Show more'}
                  </button>
                )}
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}
