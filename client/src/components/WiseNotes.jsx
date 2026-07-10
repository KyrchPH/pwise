import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
const CHAIN_GAP = 0; // docked notes sit flush against the one above (no gap)
const CHAIN_SNAP_DIST = 46; // how close (px) a dropped note's top must be to another note's bottom to dock

// Sticky-note palettes: pastel backgrounds + readable text colors. Constants
// (not theme vars) so a note keeps its chosen look in both themes. A wide set of
// light, airy tints so notes can be told apart at a glance.
const BG_COLORS = [
  { value: '#fff3a6', label: 'Yellow' },
  { value: '#fdfbc4', label: 'Lemon' },
  { value: '#ffe9c7', label: 'Peach' },
  { value: '#ffddd2', label: 'Coral' },
  { value: '#ffdfec', label: 'Pink' },
  { value: '#ffe3ef', label: 'Blush' },
  { value: '#d5f4de', label: 'Mint' },
  { value: '#e6f5d4', label: 'Sage' },
  { value: '#d3f5f2', label: 'Aqua' },
  { value: '#d9ecff', label: 'Sky' },
  { value: '#e2e7ff', label: 'Periwinkle' },
  { value: '#eee4ff', label: 'Lilac' },
  { value: '#f4e9ff', label: 'Lavender' },
  { value: '#fbf5e6', label: 'Cream' },
  { value: '#ffffff', label: 'White' },
];
const FG_COLORS = [
  { value: '#123a57', label: 'Navy' },
  { value: '#111111', label: 'Black' },
  { value: '#334155', label: 'Slate' },
  { value: '#7a4b00', label: 'Brown' },
  { value: '#b45309', label: 'Orange' },
  { value: '#b3261e', label: 'Red' },
  { value: '#a3155e', label: 'Magenta' },
  { value: '#6b21a8', label: 'Purple' },
  { value: '#3730a3', label: 'Indigo' },
  { value: '#0b57d0', label: 'Blue' },
  { value: '#0f6b6b', label: 'Teal' },
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
  if (!key) return { notes: [], hidden: false, drawerEdge: 'left' };
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    if (!parsed || !Array.isArray(parsed.notes)) return { notes: [], hidden: false, drawerEdge: 'left' };
    return {
      notes: parsed.notes.slice(0, MAX_NOTES),
      hidden: !!parsed.hidden,
      drawerEdge: parsed.drawerEdge === 'right' ? 'right' : 'left',
    };
  } catch {
    return { notes: [], hidden: false, drawerEdge: 'left' };
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

// Plain-text preview of a note's body, for the drawer list (no HTML rendered there).
export function notePreviewText(html) {
  try {
    return new DOMParser().parseFromString(sanitizeNoteHtml(html || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
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

// ── Note chaining helpers ─────────────────────────────────────────────────────
// A note may dock beneath another via `attachedTo` (the id of the note directly
// above it), forming single-child chains. These pure helpers walk that structure.

// The bottom-most note of the chain that starts at `id` (its own id if it has no
// note docked below it). Guards against cycles in stored/edited data.
function chainTail(notes, id) {
  let tail = id;
  const seen = new Set([id]);
  for (;;) {
    const child = notes.find((n) => n.attachedTo === tail);
    if (!child || seen.has(child.id)) return tail;
    seen.add(child.id);
    tail = child.id;
  }
}

// Every note at or below `rootId` in the chain (including rootId). Used to keep a
// note from docking onto itself or one of its own descendants (which would loop).
function chainDescendants(notes, rootId) {
  const set = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const n of notes) {
      if (n.attachedTo != null && set.has(n.attachedTo) && !set.has(n.id)) {
        set.add(n.id);
        added = true;
      }
    }
  }
  return set;
}

// How many notes sit above `id` in its chain (0 for a root). Used for z-ordering so
// a docked note paints over the one above it — hiding that note's drop shadow at the
// flush seam so the chain reads as one connected block.
function chainDepth(notes, id) {
  let depth = 0;
  let cur = notes.find((n) => n.id === id);
  const seen = new Set();
  while (cur && cur.attachedTo != null && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = notes.find((n) => n.id === cur.attachedTo);
    if (!parent) break;
    depth += 1;
    cur = parent;
  }
  return depth;
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
const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
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
  const [snapTarget, setSnapTarget] = useState(null); // id of the note a drag would dock beneath
  const [sizes, setSizes] = useState({}); // id -> { w, h }, measured — drives chain stacking
  const [, setViewportTick] = useState(0); // re-render on resize so clamped anchors stay on-screen
  const [focusedId, setFocusedId] = useState(null); // note briefly highlighted after being tapped in the drawer
  const [drawerDragX, setDrawerDragX] = useState(null); // px translateX while the drawer is dragged, null otherwise
  const drawerRef = useRef(null);
  const focusTimerRef = useRef(null);
  const noteEls = useRef(new Map()); // id -> DOM node, for measuring + hit-testing during drags
  const sizesRef = useRef({}); // mirror of `sizes` for the measure effect's comparisons
  const { notes, hidden, drawerEdge = 'left' } = state;

  // Measure each rendered note so docked notes can stack below their parent's real
  // height (which varies with content + minimize). Runs before paint so positions
  // never flash; the change-guard keeps it from looping on stable content.
  useLayoutEffect(() => {
    const next = { ...sizesRef.current };
    let changed = false;
    for (const n of notes) {
      const el = noteEls.current.get(n.id);
      if (!el) continue;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const prev = next[n.id];
      if (!prev || prev.w !== w || prev.h !== h) {
        next[n.id] = { w, h };
        changed = true;
      }
    }
    for (const id of Object.keys(next)) {
      if (!notes.some((n) => n.id === id)) {
        delete next[id];
        changed = true;
      }
    }
    if (changed) {
      sizesRef.current = next;
      setSizes(next);
    }
  });

  // Per-user notes: reset on identity change, then mirror every change back.
  useEffect(() => {
    setState({ userId: user?.id ?? null, ...loadState(user?.id) });
  }, [user?.id]);
  useEffect(() => {
    if (state.userId && state.userId === user?.id) {
      saveState(state.userId, { notes: state.notes, hidden: state.hidden, drawerEdge: state.drawerEdge });
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

  // The drawer dismisses on outside press / Escape. Presses on the launcher are
  // left alone — its own click toggles the drawer.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event) => {
      if (drawerRef.current?.contains(event.target)) return;
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
  // Deleting a note heals its chain: whatever was docked below it re-docks onto the
  // note it was docked to. If it was the chain's root, the note below takes its edge
  // anchor so the remaining stack stays put instead of jumping.
  const deleteNote = (id) =>
    setState((s) => {
      const removed = s.notes.find((n) => n.id === id);
      const newParent = removed?.attachedTo ?? null;
      return {
        ...s,
        notes: s.notes
          .filter((n) => n.id !== id)
          .map((n) =>
            n.attachedTo === id
              ? {
                  ...n,
                  attachedTo: newParent,
                  ...(newParent == null ? { edge: removed?.edge || 'right', offset: removed?.offset ?? NOTE_MIN_GAP } : {}),
                }
              : n,
          ),
      };
    });

  // Closing a note from its own card only takes it OFF the screen — the note itself is
  // kept (marked `dismissed`) so it can be reopened from the drawer. Deleting is a
  // separate, explicit action there. Like delete, it heals the chain: the note is
  // detached and anything docked below it re-docks onto its former parent.
  const dismissNote = (id) =>
    setState((s) => {
      const removed = s.notes.find((n) => n.id === id);
      const newParent = removed?.attachedTo ?? null;
      return {
        ...s,
        notes: s.notes.map((n) => {
          if (n.id === id) return { ...n, dismissed: true, minimized: false, attachedTo: null };
          if (n.attachedTo === id) {
            return {
              ...n,
              attachedTo: newParent,
              ...(newParent == null ? { edge: removed?.edge || 'right', offset: removed?.offset ?? NOTE_MIN_GAP } : {}),
            };
          }
          return n;
        }),
      };
    });

  // The note (if any) a note dropped at `dropRect` should dock beneath: one whose
  // bottom edge the drop lands near and horizontally overlaps. Excludes the dragged
  // note and its own descendants so a note can't dock onto its own chain.
  const findSnapTarget = (dragId, dropRect) => {
    const blocked = chainDescendants(notes, dragId);
    let bestId = null;
    let bestDist = Infinity;
    for (const n of notes) {
      if (blocked.has(n.id)) continue;
      const el = noteEls.current.get(n.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const overlapsX = dropRect.left < r.right && dropRect.right > r.left;
      if (!overlapsX) continue;
      const dist = Math.abs(dropRect.top - r.bottom);
      if (dropRect.top >= r.top && dist <= CHAIN_SNAP_DIST && dist < bestDist) {
        bestId = n.id;
        bestDist = dist;
      }
    }
    return bestId;
  };

  // Dock `dragId` directly beneath `targetId`. If the target already had a note
  // below it, that note re-docks onto the bottom of the dragged note's own chain,
  // so the drop inserts cleanly without ever giving one note two children.
  const attachNoteToChain = (dragId, targetId) =>
    setState((s) => {
      const displaced = s.notes.find((n) => n.attachedTo === targetId && n.id !== dragId);
      const dragTail = chainTail(s.notes, dragId);
      return {
        ...s,
        hidden: false,
        notes: s.notes.map((n) => {
          if (n.id === dragId) return { ...n, attachedTo: targetId };
          if (displaced && n.id === displaced.id) return { ...n, attachedTo: dragTail };
          return n;
        }),
      };
    });

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

  // Tapping a note in the drawer surfaces it on screen: reveal hidden notes, expand
  // it if minimized, bring it to the front, and flash a highlight so the eye lands
  // on it. The drawer stays open so several notes can be surfaced in a row.
  const focusNote = (id) => {
    setState((s) => ({
      ...s,
      hidden: false,
      notes: s.notes.map((n) => (n.id === id ? { ...n, minimized: false, dismissed: false } : n)),
    }));
    setFocusedId(id);
    clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusedId(null), 1600);
  };
  useEffect(() => () => clearTimeout(focusTimerRef.current), []);

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

  // Drag a note by its header. As it moves it previews docking beneath another
  // note; on release it either docks there (chaining) or, failing that, attaches to
  // the nearest screen edge. A note carries everything docked below it as it moves.
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

    const dropRectAt = (cx, cy) => {
      const left = cx - grabX;
      const top = cy - grabY;
      return { left, top, right: left + rect.width, bottom: top + rect.height };
    };

    const onMove = (e) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
      moved = true;
      setDrag({ id: note.id, x: e.clientX - grabX, y: e.clientY - grabY });
      setSnapTarget(findSnapTarget(note.id, dropRectAt(e.clientX, e.clientY)));
    };
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      const target = moved ? findSnapTarget(note.id, dropRectAt(e.clientX, e.clientY)) : null;
      setSnapTarget(null);
      if (!moved) return;
      if (target) {
        attachNoteToChain(note.id, target); // dock beneath the highlighted note
        return;
      }
      // No dock target — detach from any chain and stick to the nearest screen edge.
      const x = e.clientX - grabX;
      const y = e.clientY - grabY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const distances = [
        ['left', x],
        ['right', vw - (x + rect.width)],
        ['top', y],
        ['bottom', vh - (y + rect.height)],
      ];
      const [edge] = distances.reduce((best, d) => (d[1] < best[1] ? d : best));
      const offset = edge === 'left' || edge === 'right' ? Math.round(y) : Math.round(x);
      updateNote(note.id, { edge, offset: Math.max(NOTE_MIN_GAP, offset), attachedTo: null });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Drag the whole notes drawer horizontally by its header; on release it snaps to
  // whichever vertical screen edge (left / right) its center is nearest. The chosen
  // edge is remembered per user (persisted with the notes state).
  const startDrawerDrag = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest('button')) return; // header buttons still click
    const aside = drawerRef.current;
    if (!aside) return;
    event.preventDefault();
    const width = aside.offsetWidth;
    const baseLeft = drawerEdge === 'left' ? 0 : Math.max(0, window.innerWidth - width);
    const startX = event.clientX;
    let moved = false;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      moved = true;
      setDrawerDragX(dx);
    };
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrawerDragX(null);
      if (!moved) return;
      const center = baseLeft + (e.clientX - startX) + width / 2;
      const edge = center < window.innerWidth / 2 ? 'left' : 'right';
      setState((s) => ({ ...s, drawerEdge: edge }));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Resolve an absolute { left, top } for every note. Chain roots anchor to their
  // screen edge (as before); docked notes sit CHAIN_GAP below their parent's real
  // bottom, left-aligned. The note being dragged (and its chain) follows the pointer.
  const positions = (() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const byId = new Map(notes.map((n) => [n.id, n]));
    const sizeOf = (id) => sizes[id] || { w: 260, h: 132 };
    const cache = new Map();
    const rootPos = (n) => {
      const { w, h } = sizeOf(n.id);
      if (n.edge === 'left') return { left: 0, top: clamp(n.offset, NOTE_MIN_GAP, vh - 56) };
      if (n.edge === 'right') return { left: Math.max(0, vw - w), top: clamp(n.offset, NOTE_MIN_GAP, vh - 56) };
      if (n.edge === 'top') return { left: clamp(n.offset, NOTE_MIN_GAP, vw - 40), top: 0 };
      return { left: clamp(n.offset, NOTE_MIN_GAP, vw - 40), top: Math.max(0, vh - h) };
    };
    const resolve = (id, seen) => {
      if (cache.has(id)) return cache.get(id);
      const n = byId.get(id);
      if (!n) return { left: 0, top: 0 };
      let p;
      if (drag && drag.id === id) {
        p = { left: drag.x, top: drag.y }; // dragged note (and its chain) tracks the pointer
      } else if (n.attachedTo && byId.has(n.attachedTo) && !seen.has(n.attachedTo)) {
        const parent = resolve(n.attachedTo, new Set(seen).add(id));
        p = { left: parent.left, top: parent.top + sizeOf(n.attachedTo).h + CHAIN_GAP };
      } else {
        p = rootPos(n);
      }
      cache.set(id, p);
      return p;
    };
    const out = {};
    for (const n of notes) out[n.id] = resolve(n.id, new Set([n.id]));
    return out;
  })();

  return (
    <>
      {menuOpen && (
        <aside
          className={`wise-notes-drawer wise-notes-drawer--${drawerEdge}${drawerDragX != null ? ' is-dragging' : ''}`}
          ref={drawerRef}
          role="dialog"
          aria-label="Wise Notes"
          style={drawerDragX != null ? { transform: `translateX(${drawerDragX}px)` } : undefined}
        >
          <div
            className="wise-notes-drawer__head"
            onPointerDown={startDrawerDrag}
            title="Drag to move the panel to the other edge"
          >
            <div className="wise-notes-drawer__titlewrap">
              <span className="wise-notes-drawer__title">Notes</span>
              <span className="wise-notes-drawer__count">{notes.length}/{MAX_NOTES}</span>
            </div>
            <div className="wise-notes-drawer__actions">
              <button
                type="button"
                className="wise-notes-drawer__toggle"
                disabled={!notes.length}
                aria-pressed={!hidden}
                onClick={() => setState((s) => ({ ...s, hidden: !s.hidden }))}
                title={hidden ? 'Show notes on screen' : 'Hide notes from screen'}
              >
                {hidden ? <EyeOffIcon /> : <EyeIcon />}
                {hidden ? 'Hidden' : 'Shown'}
              </button>
              <button
                type="button"
                className="wise-notes-drawer__create"
                disabled={notes.length >= MAX_NOTES}
                onClick={openEditor}
                title={notes.length >= MAX_NOTES ? `Maximum of ${MAX_NOTES} notes` : 'Create a note'}
              >
                <PlusIcon />
                New note
              </button>
              <button
                type="button"
                className="wise-notes-drawer__close"
                onClick={onMenuClose}
                aria-label="Close notes panel"
                title="Close"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="wise-notes-drawer__list">
            {notes.length === 0 ? (
              <div className="wise-notes-drawer__empty">
                <p>No notes yet.</p>
                <Button className="btn--flat" size="sm" onClick={openEditor}>
                  <PlusIcon />
                  Create your first note
                </Button>
              </div>
            ) : (
              notes.map((note) => {
                const preview = notePreviewText(note.html);
                return (
                  <div
                    key={note.id}
                    className={`wise-notes-drawer__item${note.dismissed ? ' is-off' : ''}${focusedId === note.id ? ' is-active' : ''}`}
                    style={{ background: note.bg, color: note.fg }}
                  >
                    <button
                      type="button"
                      className="wise-notes-drawer__item-main"
                      onClick={() => focusNote(note.id)}
                      title={note.dismissed ? 'Show this note on screen' : 'Bring this note into focus'}
                    >
                      <span className="wise-notes-drawer__item-title">{note.title || 'Note'}</span>
                      {preview && <span className="wise-notes-drawer__item-preview">{preview}</span>}
                    </button>
                    <div className="wise-notes-drawer__item-actions">
                      {note.dismissed && <span className="wise-notes-drawer__item-tag">Hidden</span>}
                      <button
                        type="button"
                        className="wise-notes-drawer__item-del"
                        onClick={() => deleteNote(note.id)}
                        title="Delete note permanently"
                        aria-label="Delete note permanently"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {!hidden &&
        notes.filter((note) => !note.dismissed).map((note) => {
          // A docked note renders as a full, rounded card (not an edge strip); a
          // chain root keeps its edge styling. The corners where two notes meet are
          // squared (--has-below on the upper, --has-above on the lower) so a chain
          // reads as one connected block with no rounding at the seams.
          const docked = !!(note.attachedTo && notes.some((n) => n.id === note.attachedTo));
          const hasBelow = notes.some((n) => n.attachedTo === note.id);
          const edgeClass = docked ? 'wise-note--chained' : `wise-note--${note.edge}`;
          const seamClass = `${docked ? ' wise-note--has-above' : ''}${hasBelow ? ' wise-note--has-below' : ''}`;
          // Lower notes paint above higher ones (and the whole dragged chain floats
          // above everything) so seams stay clean.
          const inDrag = drag && chainDescendants(notes, drag.id).has(note.id);
          const zIndex = 44 + chainDepth(notes, note.id) + (inDrag ? 200 : 0) + (focusedId === note.id ? 150 : 0);
          return (
          <div
            key={note.id}
            ref={(el) => {
              if (el) noteEls.current.set(note.id, el);
              else noteEls.current.delete(note.id);
            }}
            data-note-id={note.id}
            className={`wise-note ${edgeClass}${seamClass}${note.minimized ? ' is-min' : ''}${drag?.id === note.id ? ' is-dragging' : ''}${snapTarget === note.id ? ' is-snap-target' : ''}${focusedId === note.id ? ' is-focused' : ''}`}
            style={{ ...positions[note.id], right: 'auto', bottom: 'auto', zIndex, background: note.bg, color: note.fg }}
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
                  onClick={() => dismissNote(note.id)}
                  title="Close note (keeps it in the list)"
                  aria-label="Close note"
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
          );
        })}

      {editorOpen && <NoteEditor note={editingNote} onClose={closeEditor} onSave={saveEditor} />}
    </>
  );
}
