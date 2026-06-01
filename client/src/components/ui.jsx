import { useState } from 'react';

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

export function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="card__head">
          <div className="card__title">{title}</div>
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
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
      src="/logo.png"
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
  if (mediaType === 'image' && mediaUrl && !broken) {
    return (
      <div className="thumb">
        <img src={mediaUrl} alt="" onError={() => setBroken(true)} />
      </div>
    );
  }
  const icon = mediaType === 'video' ? '🎬' : mediaType === 'image' ? '🖼️' : '📝';
  return (
    <div className="thumb">
      <span className="thumb__placeholder">{icon}</span>
    </div>
  );
}
