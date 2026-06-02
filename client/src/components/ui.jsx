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

function EyeIcon({ off = false }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  return off ? (
    <svg {...common}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg {...common}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
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
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

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
        onClick={() => setOpen((o) => !o)}
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
        <div className="timeselect__menu" role="listbox" ref={menuRef}>
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

export function Modal({ open, title, onClose, children, footer, dismissable = true, className = '' }) {
  if (!open) return null;
  return (
    // When not dismissable, the backdrop swallows clicks (no onClose) and the ✕
    // is hidden, so the only way out is the action completing — a true barrier.
    <div className="overlay" onClick={dismissable ? onClose : undefined}>
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
