import { useMemo, useState } from 'react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * Month calendar showing how many posts are scheduled on each day.
 * Empty upcoming days (no post set yet) are highlighted as "open".
 */
export default function CalendarMonth({ posts = [] }) {
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });

  // Bucket scheduled posts by their LOCAL calendar day.
  const counts = useMemo(() => {
    const map = {};
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const d = new Date(p.scheduled_at);
      if (Number.isNaN(d.getTime())) continue;
      const k = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  }, [posts]);

  const { year, month } = view;
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const go = (delta) =>
    setView((v) => {
      const m = v.month + delta;
      if (m < 0) return { year: v.year - 1, month: 11 };
      if (m > 11) return { year: v.year + 1, month: 0 };
      return { year: v.year, month: m };
    });

  const openCount = cells.filter((d) => {
    if (d === null) return false;
    const cell = new Date(year, month, d);
    return cell >= todayMidnight && !(counts[keyOf(year, month, d)] > 0);
  }).length;

  return (
    <div className="calendar">
      <div className="calendar__head">
        <button className="btn btn--ghost btn--icon" onClick={() => go(-1)} aria-label="Previous month">
          ‹
        </button>
        <div className="calendar__title">
          {MONTHS[month]} {year}
        </div>
        <button className="btn btn--ghost btn--icon" onClick={() => go(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="calendar__grid calendar__dow">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar__dowcell">
            {w}
          </div>
        ))}
      </div>

      <div className="calendar__grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="calendar__cell calendar__cell--blank" />;
          const k = keyOf(year, month, d);
          const count = counts[k] || 0;
          const cell = new Date(year, month, d);
          const isPast = cell < todayMidnight;
          const isToday = k === todayKey;
          const isOpen = count === 0 && !isPast; // no post set yet (upcoming)
          const cls = [
            'calendar__cell',
            isToday && 'is-today',
            isOpen && 'is-open',
            isPast && count === 0 && 'is-past',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={k} className={cls}>
              <span className="calendar__day">{d}</span>
              {count > 0 ? (
                <span className="calendar__count" title={`${count} scheduled`}>
                  {count}
                </span>
              ) : isOpen ? (
                <span className="calendar__open" title="No post set yet">
                  +
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="calendar__legend">
        <span>
          <i className="dot dot--count" /> has posts
        </span>
        <span>
          <i className="dot dot--open" /> open day ({openCount} this month)
        </span>
      </div>
    </div>
  );
}
