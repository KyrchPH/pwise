import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui.jsx';

// The three things you can create, in the order the dropdown lists them.
const ITEMS = [
  { type: 'reel', label: 'Create Reel', hint: 'Vertical short video' },
  { type: 'video', label: 'Create Video', hint: 'Feed video' },
  { type: 'post', label: 'Create a Post', hint: 'Text or photo' },
];

const Caret = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/**
 * The "+ Create" split-style dropdown that opens the Compose view for a chosen
 * content type. Replaces the old "+ Upload post" buttons. `size`/`className` are
 * forwarded to the trigger Button so it fits each toolbar.
 */
export default function CreateContentMenu({ size, className = '', label = '+ Create' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (type) => {
    setOpen(false);
    navigate(`/post-pool?view=compose&type=${type}`);
  };

  return (
    <span className="create-menu" ref={ref}>
      <Button size={size} className={`btn--flat create-menu__btn ${className}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {label} <Caret />
      </Button>
      {open && (
        <div className="create-menu__pop" role="menu">
          {ITEMS.map((it) => (
            <button key={it.type} type="button" role="menuitem" className="create-menu__item" onClick={() => go(it.type)}>
              <span className="create-menu__item-label">{it.label}</span>
              <span className="create-menu__item-hint">{it.hint}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
