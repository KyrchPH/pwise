import { useEffect, useRef, useState } from 'react';
import { PageAvatar } from '../../components/ui.jsx';

const PERIOD_LABEL = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const STATUS_LABEL = { ongoing: 'Ongoing', completed: 'Completed', expired: 'Expired' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDay(s) {
  if (!s) return '';
  const [, m, d] = s.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function fmtRange(a, b) {
  if (!a || !b) return '';
  const year = b.split('-')[0];
  return `${fmtDay(a)} – ${fmtDay(b)}, ${year}`;
}

const fmtNum = (n) => Number(n || 0).toLocaleString();

function KebabIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

export default function GoalCard({ goal, page, onEdit, onDelete }) {
  const { status, percent, current_value: current, target_value: target, period } = goal;
  const complete = status === 'completed';

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the kebab menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className={`goal-tile goal-tile--${status}`}>
      <PageAvatar page={page} className="goal-tile__avatar" />

      <div className="goal-tile__body">
        <div className="goal-tile__head">
          <h3 className="goal-tile__title">{goal.title}</h3>
          <span className={`goal-status goal-status--${status}`}>{STATUS_LABEL[status] || status}</span>
        </div>

        <div className="goal-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={`goal-progress__fill${complete ? ' is-complete' : ''}`} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>

        <div className="goal-tile__stats">
          <span className="goal-tile__count">
            <strong>{fmtNum(current)}</strong> / {fmtNum(target)}
          </span>
          <span className="goal-tile__percent">{percent}%</span>
        </div>

        <div className="goal-tile__meta">
          <span className="goal-chip">{PERIOD_LABEL[period] || period}</span>
          <span className="goal-tile__range">{fmtRange(goal.start_date, goal.end_date)}</span>
        </div>
      </div>

      <div className="goal-tile__menu" ref={menuRef}>
        <button
          type="button"
          className="goal-tile__kebab"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Goal actions"
        >
          <KebabIcon />
        </button>
        {menuOpen && (
          <div className="goal-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="goal-menu__opt"
              onClick={() => {
                setMenuOpen(false);
                onEdit?.(goal);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              className="goal-menu__opt goal-menu__opt--danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete?.(goal);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
