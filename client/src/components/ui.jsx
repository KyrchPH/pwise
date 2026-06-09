import { useEffect, useRef, useState } from 'react';

export function Button({ as: Comp = 'button', variant = 'primary', size = 'md', className = '', ...props }) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, className].filter(Boolean).join(' ');
  return <Comp className={cls} {...props} />;
}

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

// Render plain text with URLs turned into clickable links. Handles http(s):// and
// bare www. links; all other text renders verbatim (newlines preserved by the
// caller's white-space styling). Links open in a new tab.
const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)/gi;
const isUrl = (s) => /^(?:https?:\/\/|www\.)/i.test(s);
const hrefFor = (s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);

export function Linkify({ text }) {
  if (!text) return null;
  return String(text)
    .split(URL_RE)
    .map((part, i) =>
      isUrl(part) ? (
        <a key={i} className="link" href={hrefFor(part)} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      ) : (
        part
      ),
    );
}

// Outline icons (Feather-style) matching the app's SVG convention: 24-unit grid,
// no fill, currentColor stroke, round joins. `size` sets the px width/height.
function OutlineIcon({ size = 16, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function HeartIcon({ size }) {
  return (
    <OutlineIcon size={size}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </OutlineIcon>
  );
}

export function CommentIcon({ size }) {
  return (
    <OutlineIcon size={size}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </OutlineIcon>
  );
}

export function ShareIcon({ size }) {
  return (
    <OutlineIcon size={size}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </OutlineIcon>
  );
}

export function EyeIcon({ off = false, size = 18 }) {
  return off ? (
    <OutlineIcon size={size}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </OutlineIcon>
  ) : (
    <OutlineIcon size={size}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </OutlineIcon>
  );
}

// Text/password input with a show/hide toggle. Forwards all input props.
export function PasswordInput({ className = '', ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <input className={`input ${className}`} type={show ? 'text' : 'password'} {...props} />
      <button
        type="button"
        className="password-toggle"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
      >
        <EyeIcon off={show} />
      </button>
    </div>
  );
}

// Half-hour slots (00:00–23:30) for the schedule time picker.
const HALF_HOUR_SLOTS = [];
for (let h = 0; h < 24; h += 1) {
  for (const m of [0, 30]) {
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const label = `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    HALF_HOUR_SLOTS.push({ value, label, minutes: h * 60 + m });
  }
}

// Local YYYY-MM-DD (same format the date <input> uses for value/min).
function localDateStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Time picker — a CUSTOM dropdown (not a native <select>) so options can be
// fully styled. When `date` is today, passed slots are shown clearly greyed +
// struck through + tagged "passed" (and not selectable), so there's an obvious
// distinction between what you can and can't pick. Calls onChange with an
// event-like { target: { value } } to match the rest of the form.
export function TimeSelect({ value, onChange, date, className = '', placeholder = 'Pick a time' }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

  // Open the menu upward when there isn't room below (e.g. near a modal's bottom),
  // so it doesn't overflow and force the container to scroll.
  const toggle = () => {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      const menuH = 280; // ~ max-height (264) + paddings/margin
      const spaceBelow = window.innerHeight - r.bottom;
      setDropUp(spaceBelow < menuH && r.top > spaceBelow);
    }
    setOpen((o) => !o);
  };

  const now = new Date();
  const isToday = date && date === localDateStr(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isPast = (slot) => isToday && slot.minutes <= nowMinutes && slot.value !== value;
  const selected = HALF_HOUR_SLOTS.find((s) => s.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Center the menu on the selected slot (else the first still-pickable one) so
    // you don't have to scroll past the morning when it's already afternoon.
    const menu = menuRef.current;
    const target = menu?.querySelector('.is-selected') || menu?.querySelector('.timeselect__opt:not(:disabled)');
    if (menu && target) menu.scrollTop = target.offsetTop - menu.clientHeight / 2 + target.clientHeight / 2;
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (v) => {
    onChange?.({ target: { value: v } });
    setOpen(false);
  };

  return (
    <div className={`timeselect ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={`timeselect__btn${selected ? '' : ' timeselect__btn--placeholder'}`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <svg
          className="timeselect__caret"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className={`timeselect__menu${dropUp ? ' timeselect__menu--up' : ''}`} role="listbox" ref={menuRef}>
          {HALF_HOUR_SLOTS.map((s) => {
            const past = isPast(s);
            const sel = s.value === value;
            return (
              <button
                type="button"
                key={s.value}
                role="option"
                aria-selected={sel}
                disabled={past}
                className={`timeselect__opt${sel ? ' is-selected' : ''}${past ? ' is-past' : ''}`}
                onClick={() => pick(s.value)}
              >
                <span>{s.label}</span>
                {past && <span className="timeselect__tag">passed</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" />
      {label && <span>{label}</span>}
    </label>
  );
}

// Compact custom dropdown with a styled menu (a native <select> can't style its
// options). `options` = [{ value, label, disabled }]. Closes on outside-click / Esc.
export function Dropdown({ value, options = [], onChange, ariaLabel, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`dropdown${open ? ' is-open' : ''} ${className}`.trim()} ref={ref}>
      <button
        type="button"
        className="dropdown__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{current?.label ?? '—'}</span>
        <svg className="dropdown__caret" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="dropdown__menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              className={`dropdown__opt${o.value === value ? ' is-selected' : ''}`}
              onClick={() => {
                if (o.disabled) return;
                onChange?.(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && (
                <span className="dropdown__check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function FullScreenSpinner() {
  return (
    <div className="full-spinner">
      <span className="spinner" />
    </div>
  );
}

// Upload/progress bar. Pass a 0..100 `value` for a determinate bar, or
// `indeterminate` for a sliding bar when the percentage isn't known yet.
export function ProgressBar({ value = 0, label, indeterminate = false }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
    >
      {(label || !indeterminate) && (
        <div className="progress__head">
          <span className="progress__label">{label}</span>
          {!indeterminate && <span className="progress__pct">{pct}%</span>}
        </div>
      )}
      <div className="progress__track">
        <div
          className={`progress__bar${indeterminate ? ' progress__bar--indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge badge--${status || 'draft'}`}>{status || 'unknown'}</span>;
}

export function EmptyState({ icon = '📭', title, message, action }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      {title && <div className="empty__title">{title}</div>}
      {message && <div>{message}</div>}
      {action && <div className="mt-lg">{action}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, dismissable = true, className = '', hidden = false }) {
  // Lock background page scroll while the dialog is open; restore on close/unmount.
  // Released while `hidden` (e.g. dragging an item out) so the page behind can scroll.
  useEffect(() => {
    if (!open || hidden) return undefined;
    // Lock the app's scroll container (the content area) so the background
    // doesn't scroll behind the dialog. Falls back to body on shell-less pages.
    const scroller = document.querySelector('.content') || document.body;
    const prev = scroller.style.overflow;
    scroller.style.overflow = 'hidden';
    return () => {
      scroller.style.overflow = prev;
    };
  }, [open, hidden]);

  if (!open) return null;
  return (
    // `hidden` keeps the dialog mounted but visually gone and click-through — used
    // while dragging an item out onto the page behind it. When not dismissable, the
    // backdrop swallows clicks and the ✕ is hidden, so it's a true barrier.
    <div className={`overlay${hidden ? ' overlay--hidden' : ''}`} onClick={dismissable ? onClose : undefined}>
      <div className={`card modal ${className}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="card__head">
          <div className="card__title">{title}</div>
          {dismissable && (
            <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="card--pad">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

// App logo (client/public/logo.png). Falls back to the text wordmark if the
// file isn't present yet.
export function Logo({ height = 40, className = '' }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="brand">
        <span className="brand__mark">p</span>
        <span className="brand__name">pwise</span>
      </span>
    );
  }
  return (
    <img
      src="/logo.jpg"
      alt="Wise Cleaner Shop"
      className={`logo-img ${className}`}
      style={{ height }}
      onError={() => setBroken(true)}
    />
  );
}

// Renders the media image; falls back to a type icon if it can't load
// (private S3 objects aren't directly viewable without a presigned URL).
export function MediaThumb({ mediaUrl, mediaType }) {
  const [broken, setBroken] = useState(false);
  if (mediaUrl && !broken) {
    if (mediaType === 'image') {
      return (
        <div className="thumb">
          <img src={mediaUrl} alt="" onError={() => setBroken(true)} />
        </div>
      );
    }
    if (mediaType === 'video') {
      // #t=0.5 nudges the browser to show a frame instead of a black poster.
      return (
        <div className="thumb">
          <video src={`${mediaUrl}#t=0.5`} muted preload="metadata" playsInline onError={() => setBroken(true)} />
          <span className="thumb__play">▶</span>
        </div>
      );
    }
  }
  const icon = mediaType === 'video' ? '🎬' : mediaType === 'image' ? '🖼️' : '📝';
  return (
    <div className="thumb">
      <span className="thumb__placeholder">{icon}</span>
    </div>
  );
}
