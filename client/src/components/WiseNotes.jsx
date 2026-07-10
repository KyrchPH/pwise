import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { subscribeWiseUi } from '../utils/wiseUiBus.js';
import { Button, Dropdown, Modal } from './ui.jsx';

// Wise Notes — sticky notes that anchor to the screen edges. The notes lottie
// (rendered by DevScreenAgent) is the launcher: a press opens a small menu with
// "Show/Hide notes" and "Create a note". Notes are a pure per-user UI aid, kept
// in localStorage (they never leave the browser).

const MAX_NOTES = 6;
const NOTE_MIN_GAP = 8; // px a note keeps from the viewport corners
const DRAG_THRESHOLD = 5;

// Sticky-note palettes: pastel backgrounds + readable text colors. Constants
// (not theme vars) so a note keeps its chosen look in both themes.
const BG_COLORS = [
  { value: '#fff3a6', label: 'Yellow' },
  { value: '#d5f4de', label: 'Mint' },
  { value: '#d9ecff', label: 'Sky' },
  { value: '#ffdfec', label: 'Pink' },
  { value: '#eee4ff', label: 'Lilac' },
  { value: '#ffffff', label: 'White' },
];
const FG_COLORS = [
  { value: '#123a57', label: 'Navy' },
  { value: '#111111', label: 'Black' },
  { value: '#7a4b00', label: 'Brown' },
  { value: '#b3261e', label: 'Red' },
  { value: '#0b57d0', label: 'Blue' },
  { value: '#0f7b40', label: 'Green' },
];
// A dropdown option showing the colour itself next to its name.
const colorOption = ({ value, label }) => ({
  value,
  label: (
    <span className="color-opt">
      <span className="color-opt__dot" style={{ background: value }} />
      {label}
    </span>
  ),
});
const EMOJIS = ['😀', '🎉', '✅', '📌', '🔥', '💡', '⭐', '❗'];

function storageKey(userId) {
  return userId ? `pwise.wiseNotes.${userId}` : null;
}
function loadState(userId) {
  const key = storageKey(userId);
  if (!key) return { notes: [], hidden: false };
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    if (!parsed || !Array.isArray(parsed.notes)) return { notes: [], hidden: false };
    return { notes: parsed.notes.slice(0, MAX_NOTES), hidden: !!parsed.hidden };
  } catch {
    return { notes: [], hidden: false };
  }
}
function saveState(userId, state) {
  const key = storageKey(userId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* storage unavailable/full — non-fatal */
  }
}

// The editor is a contentEditable div, so its HTML is sanitized through an
// allowlist before it is stored or rendered: formatting tags only, and links
// keep just a safe http(s) href.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN', 'A']);
export function sanitizeNoteHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes); // unwrap unknown tags, keep their content
      continue;
    }
    let href = null;
    if (el.tagName === 'A') {
      href = el.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) href = null;
    }
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    if (el.tagName === 'A') {
      if (!href) {
        el.replaceWith(...el.childNodes);
      } else {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }
  return doc.body.innerHTML;
}

function clipboardHasImage(data) {
  if (!data) return false;
  const items = Array.from(data.items || []);
  const files = Array.from(data.files || []);
  return (
    items.some((item) => item.type?.startsWith('image/')) ||
    files.some((file) => file.type?.startsWith('image/')) ||
    /<img\b|data:image\//i.test(data.getData('text/html') || '')
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function Icon({ children, size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);
const EyeIcon = () => (
  <Icon>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
const EyeOffIcon = () => (
  <Icon>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </Icon>
);
const MinimizeIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);
const RestoreIcon = () => (
  <Icon>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </Icon>
);
const EditIcon = () => (
  <Icon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </Icon>
);
const CloseIcon = () => (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);
const LinkIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);
const ListIcon = () => (
  <Icon>
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
  </Icon>
);

// ── Create dialog ────────────────────────────────────────────────────────────
function NoteEditor({ note = null, onClose, onSave }) {
  const toast = useToast();
  const [title, setTitle] = useState(note?.title || '');
  const [bg, setBg] = useState(note?.bg || BG_COLORS[0].value);
  const [fg, setFg] = useState(note?.fg || FG_COLORS[0].value);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const bodyRef = useRef(null);
  const linkInputRef = useRef(null);
  const savedRangeRef = useRef(null); // selection to re-apply when the link row commits
  const isEditing = !!note;

  const exec = (command, value) => {
    bodyRef.current?.focus();
    document.execCommand(command, false, value);
  };
  // mousedown (not click) so the button press never steals the text selection
  const keepSelection = (event) => event.preventDefault();

  const openLinkRow = () => {
    const selection = window.getSelection();
    savedRangeRef.current =
      selection && selection.rangeCount > 0 && bodyRef.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    setLinkUrl('');
    setLinkMode(true);
  };
  useEffect(() => {
    if (linkMode) linkInputRef.current?.focus();
  }, [linkMode]);

  useEffect(() => {
    setTitle(note?.title || '');
    setBg(note?.bg || BG_COLORS[0].value);
    setFg(note?.fg || FG_COLORS[0].value);
    if (bodyRef.current) bodyRef.current.innerHTML = sanitizeNoteHtml(note?.html || '');
  }, [note]);

  const applyLink = () => {
    let url = linkUrl.trim();
    setLinkMode(false);
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const range = savedRangeRef.current;
    savedRangeRef.current = null;
    bodyRef.current?.focus();
    if (range) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (range && !range.collapsed) {
      document.execCommand('createLink', false, url);
    } else {
      // No text selected — insert the URL itself as the link.
      const safe = url.replace(/"/g, '%22').replace(/</g, '%3C');
      document.execCommand('insertHTML', false, `<a href="${safe}">${safe}</a>&nbsp;`);
    }
  };

  const save = () => {
    const html = sanitizeNoteHtml(bodyRef.current?.innerHTML || '');
    const text = (bodyRef.current?.textContent || '').trim();
    if (!text && !title.trim()) {
      toast.error('Write something in the note first.');
      return;
    }
    onSave({ title: title.trim(), html, bg, fg });
  };

  const pasteIntoBody = (event) => {
    const data = event.clipboardData;
    if (!data) return;
    const hasImage = clipboardHasImage(data);
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    event.preventDefault();

    if (html) {
      const cleanHtml = sanitizeNoteHtml(html);
      const cleanText = new DOMParser().parseFromString(cleanHtml, 'text/html').body.textContent.trim();
      if (cleanHtml && cleanText) {
        document.execCommand('insertHTML', false, cleanHtml);
        if (hasImage) toast.info('Photos cannot be pasted into notes.');
        return;
      }
    }

    if (text.trim()) {
      document.execCommand('insertText', false, text);
      if (hasImage) toast.info('Photos cannot be pasted into notes.');
      return;
    }

    if (hasImage) toast.info('Photos cannot be pasted into notes.');
  };

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      className="modal--wise-note"
      title={isEditing ? 'Edit sticky note' : 'New sticky note'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className="btn--flat" onClick={save}>{isEditing ? 'Save changes' : 'Add note'}</Button>
        </>
      }
    >
      <div className="wise-note-editor">
        <input
          className="input"
          placeholder="Title (optional)"
          aria-label="Note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="wise-note-editor__toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" className="wise-note-editor__tool" onMouseDown={keepSelection} onClick={() => exec('bold')} title="Bold" aria-label="Bold">
            <b>B</b>
          </button>
          <button type="button" className="wise-note-editor__tool" onMouseDown={keepSelection} onClick={() => exec('italic')} title="Italic" aria-label="Italic">
            <i>I</i>
          </button>
          <button type="button" className="wise-note-editor__tool" onMouseDown={keepSelection} onClick={() => exec('insertUnorderedList')} title="Bullet list" aria-label="Bullet list">
            <ListIcon />
          </button>
          <button type="button" className="wise-note-editor__tool" onMouseDown={keepSelection} onClick={openLinkRow} title="Insert link" aria-label="Insert link">
            <LinkIcon />
          </button>
          <span className="wise-note-editor__sep" aria-hidden="true" />
          {EMOJIS.map((emoji) => (
            <button
              type="button"
              key={emoji}
              className="wise-note-editor__tool wise-note-editor__tool--emoji"
              onMouseDown={keepSelection}
              onClick={() => exec('insertText', emoji)}
              title={`Insert ${emoji}`}
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        {linkMode && (
          <div className="wise-note-editor__linkrow">
            <input
              ref={linkInputRef}
              className="input"
              placeholder="https://example.com"
              aria-label="Link URL"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === 'Escape') setLinkMode(false);
              }}
            />
            <Button size="sm" className="btn--flat" onClick={applyLink}>Apply</Button>
            <Button size="sm" variant="ghost" onClick={() => setLinkMode(false)}>Cancel</Button>
          </div>
        )}

        <div
          ref={bodyRef}
          className="wise-note-editor__body"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Note text"
          onPaste={pasteIntoBody}
          data-placeholder="Write your note…"
          style={{ background: bg, color: fg }}
        />

        <div className="wise-note-editor__colors">
          <span className="wise-note-editor__colors-label">Background</span>
          <Dropdown
            className="dropdown--up"
            ariaLabel="Background color"
            value={bg}
            onChange={setBg}
            options={BG_COLORS.map(colorOption)}
          />
          <span className="wise-note-editor__colors-label">Text</span>
          <Dropdown
            className="dropdown--up"
            ariaLabel="Text color"
            value={fg}
            onChange={setFg}
            options={FG_COLORS.map(colorOption)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Root: menu + anchored notes + editor ────────────────────────────────────
export default function WiseNotes({ menuOpen, onMenuClose, anchorRef }) {
  const { user } = useAuth();
  const toast = useToast();
  // `userId` inside the state marks WHOSE notes are loaded. The mirror effect only
  // writes state that carries the current user's id — the initial empty state
  // (userId: null) can never clobber storage, even under StrictMode's double-mount.
  const [state, setState] = useState({ userId: null, notes: [], hidden: false });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [drag, setDrag] = useState(null); // { id, x, y } while a note is dragged
  const [, setViewportTick] = useState(0); // re-render on resize so clamped anchors stay on-screen
  const menuRef = useRef(null);
  const { notes, hidden } = state;

  // Per-user notes: reset on identity change, then mirror every change back.
  useEffect(() => {
    setState({ userId: user?.id ?? null, ...loadState(user?.id) });
  }, [user?.id]);
  useEffect(() => {
    if (state.userId && state.userId === user?.id) {
      saveState(state.userId, { notes: state.notes, hidden: state.hidden });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const onResize = () => setViewportTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Let the Wise Assistant show/hide the notes. It emits an op; we resolve against
  // the live `hidden` flag here.
  useEffect(() =>
    subscribeWiseUi((event) => {
      if (event.kind !== 'notes') return;
      setState((s) => ({
        ...s,
        hidden: event.op === 'show' ? false : event.op === 'hide' ? true : !s.hidden,
      }));
    }), []);

  // The menu dismisses on outside press / Escape. Presses on the launcher are
  // left alone — its own click toggles the menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (anchorRef?.current?.contains(event.target)) return;
      onMenuClose();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onMenuClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, onMenuClose, anchorRef]);

  const updateNote = (id, patch) =>
    setState((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const deleteNote = (id) => setState((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));

  const openEditor = () => {
    if (notes.length >= MAX_NOTES) {
      toast.error(`You can keep up to ${MAX_NOTES} notes — close one first.`);
      return;
    }
    setEditingNote(null);
    setEditorOpen(true);
    onMenuClose();
  };

  const addNote = ({ title, html, bg, fg }) => {
    setState((s) => {
      if (s.notes.length >= MAX_NOTES) return s;
      const note = {
        id: `n-${Date.now().toString(36)}`,
        title,
        html,
        bg,
        fg,
        edge: 'right',
        offset: 90 + s.notes.length * 56, // stagger down the right edge
        minimized: false,
      };
      return { ...s, hidden: false, notes: [...s.notes, note] }; // creating always reveals notes
    });
    setEditorOpen(false);
    setEditingNote(null);
  };

  const editNote = (note) => {
    setEditingNote(note);
    setEditorOpen(true);
    onMenuClose?.();
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingNote(null);
  };

  const saveEditor = ({ title, html, bg, fg }) => {
    if (editingNote) {
      updateNote(editingNote.id, { title, html, bg, fg });
      closeEditor();
      return;
    }
    addNote({ title, html, bg, fg });
  };

  // Drag a note by its header; on release it attaches to the nearest screen edge.
  const startNoteDrag = (event, note) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest('.wise-note__actions')) return; // buttons still click
    const el = event.currentTarget.closest('.wise-note');
    if (!el) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;

    const onMove = (e) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
      moved = true;
      setDrag({ id: note.id, x: e.clientX - grabX, y: e.clientY - grabY });
    };
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (!moved) return;
      const x = e.clientX - grabX;
      const y = e.clientY - grabY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Attach to whichever edge the note was dropped closest to.
      const distances = [
        ['left', x],
        ['right', vw - (x + rect.width)],
        ['top', y],
        ['bottom', vh - (y + rect.height)],
      ];
      const [edge] = distances.reduce((best, d) => (d[1] < best[1] ? d : best));
      const offset = edge === 'left' || edge === 'right' ? Math.round(y) : Math.round(x);
      updateNote(note.id, { edge, offset: Math.max(NOTE_MIN_GAP, offset) });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Anchored position for a note: flush against its edge, clamped so the header
  // always stays reachable even after a resize.
  const noteStyle = (note) => {
    if (drag && drag.id === note.id) {
      return { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto' };
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (note.edge === 'left') return { left: 0, top: clamp(note.offset, NOTE_MIN_GAP, vh - 56) };
    if (note.edge === 'right') return { right: 0, top: clamp(note.offset, NOTE_MIN_GAP, vh - 56) };
    if (note.edge === 'top') return { top: 0, left: clamp(note.offset, NOTE_MIN_GAP, vw - 200) };
    return { bottom: 0, left: clamp(note.offset, NOTE_MIN_GAP, vw - 200) };
  };

  // Menu placement beside the launcher lottie, kept on-screen.
  const menuStyle = (() => {
    const rect = anchorRef?.current?.getBoundingClientRect();
    if (!rect) return { display: 'none' };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = rect.left > vw / 2 ? rect.left - 196 : rect.right + 8;
    return { left: clamp(left, 8, vw - 196), top: clamp(rect.top + 8, 8, vh - 110) };
  })();

  return (
    <>
      {menuOpen && (
        <div className="wise-notes-menu" style={menuStyle} ref={menuRef} role="menu" aria-label="Wise Notes">
          <button
            type="button"
            role="menuitem"
            className="wise-notes-menu__item"
            disabled={!notes.length}
            onClick={() => {
              setState((s) => ({ ...s, hidden: !s.hidden }));
              onMenuClose();
            }}
          >
            {hidden ? <EyeIcon /> : <EyeOffIcon />}
            {hidden ? 'Show notes' : 'Hide notes'}
            <span className="wise-notes-menu__count">{notes.length}/{MAX_NOTES}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="wise-notes-menu__item"
            disabled={notes.length >= MAX_NOTES}
            onClick={openEditor}
            title={notes.length >= MAX_NOTES ? `Maximum of ${MAX_NOTES} notes` : undefined}
          >
            <PlusIcon />
            Create a note
            {notes.length >= MAX_NOTES && <span className="wise-notes-menu__count">max</span>}
          </button>
        </div>
      )}

      {!hidden &&
        notes.map((note) => (
          <div
            key={note.id}
            className={`wise-note wise-note--${note.edge}${note.minimized ? ' is-min' : ''}${drag?.id === note.id ? ' is-dragging' : ''}`}
            style={{ ...noteStyle(note), background: note.bg, color: note.fg }}
            role="note"
            aria-label={note.title || 'Sticky note'}
          >
            <div className="wise-note__head" onPointerDown={(e) => startNoteDrag(e, note)} title="Drag to another edge">
              <span className="wise-note__title">{note.title || 'Note'}</span>
              <span className="wise-note__actions">
                <button
                  type="button"
                  className="wise-note__btn"
                  onClick={() => editNote(note)}
                  title="Edit note"
                  aria-label="Edit note"
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="wise-note__btn"
                  onClick={() => updateNote(note.id, { minimized: !note.minimized })}
                  title={note.minimized ? 'Expand' : 'Minimize'}
                  aria-label={note.minimized ? 'Expand note' : 'Minimize note'}
                >
                  {note.minimized ? <RestoreIcon /> : <MinimizeIcon />}
                </button>
                <button
                  type="button"
                  className="wise-note__btn"
                  onClick={() => deleteNote(note.id)}
                  title="Delete note"
                  aria-label="Delete note"
                >
                  <CloseIcon />
                </button>
              </span>
            </div>
            {!note.minimized && (
              // Sanitized at save time AND at render time (belt & braces for old stored data).
              // eslint-disable-next-line react/no-danger
              <div className="wise-note__body" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note.html) }} />
            )}
          </div>
        ))}

      {editorOpen && <NoteEditor note={editingNote} onClose={closeEditor} onSave={saveEditor} />}
    </>
  );
}
