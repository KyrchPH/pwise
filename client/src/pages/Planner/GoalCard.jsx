// A Facebook-"Weekly plan"-style task row for a single goal: the owning page's
// avatar (with a small metric badge on its corner), the goal title + a context
// subline, and a trailing status cluster that shows a terminal-state pill
// (Completed / Expired) or a live "X of Y" count with a mini progress bar. The
// row's single action is Edit (delete lives in the edit modal).
import { PageAvatar } from '../../components/ui.jsx';

const PERIOD_LABEL = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

// Plural noun shown after the count, e.g. "4 of 8 posts".
const METRIC_NOUN = {
  followers: 'followers',
  posts: 'posts',
  comments: 'comments',
  shares: 'shares',
  views: 'views',
  reactions: 'reactions',
  sales: 'in sales',
  promoters: 'promoters',
  neutral: 'neutral',
  detractors: 'detractors',
};

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

// Feather-style outline glyph per metric (24-grid, currentColor stroke).
function MetricIcon({ metric, size = 22 }) {
  const glyph = {
    posts: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </>
    ),
    followers: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    views: (
      <>
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    reactions: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
    comments: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    shares: (
      <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </>
    ),
    // Sales — a price tag.
    sales: (
      <>
        <path d="M20.59 13.41 12 22l-9-9V3h10l7.59 7.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </>
    ),
    // NPS buckets — a smiley whose mouth curve signals sentiment.
    promoters: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </>
    ),
    neutral: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="8" y1="15" x2="16" y2="15" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </>
    ),
    detractors: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {glyph[metric] || glyph.posts}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function GoalCard({ goal, page, onEdit, canEdit = true }) {
  const { status, percent, current_value: current, target_value: target, metric } = goal;
  const noun = METRIC_NOUN[metric] || metric;
  const desc = [page?.account_name, PERIOD_LABEL[goal.period], fmtRange(goal.start_date, goal.end_date)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`task-row task-row--${status}`}>
      <div className="task-row__avatar">
        <PageAvatar page={page} className="task-row__photo" />
        <span className={`task-row__badge task-row__badge--${metric}`}>
          <MetricIcon metric={metric} size={12} />
        </span>
      </div>

      <div className="task-row__body">
        <div className="task-row__title">{goal.title}</div>
        {desc && <div className="task-row__desc">{desc}</div>}
      </div>

      <div className="task-row__status">
        {status === 'completed' ? (
          <span className="task-pill task-pill--done">
            <CheckIcon /> Completed
          </span>
        ) : status === 'expired' ? (
          <span className="task-pill task-pill--expired">Expired</span>
        ) : (
          <div className="task-meter">
            <div className="task-meter__label">
              <strong>{fmtNum(current)}</strong> of {fmtNum(target)} {noun}
            </div>
            <div className="task-meter__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="task-meter__fill" style={{ width: `${Math.min(percent, 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      {canEdit && (
        <button type="button" className="task-row__action" onClick={() => onEdit?.(goal)}>
          Edit
        </button>
      )}
    </div>
  );
}
