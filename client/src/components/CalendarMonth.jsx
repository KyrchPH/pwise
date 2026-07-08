import { useEffect, useMemo, useState } from 'react';
import * as notesService from '../services/content_notes.service.js';
import { apiError } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { PageAvatar } from './ui.jsx';
import DayNotesModal from './DayNotesModal.jsx';
import CreatePostModal from './CreatePostModal.jsx';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

const STATUS_LABELS = { pending: 'Pending', ongoing: 'Ongoing', completed: 'Completed', cancelled: 'Cancelled' };
const statusLabel = (s) => STATUS_LABELS[s] || 'Pending';
// Build the minimal shape PageAvatar reads (name + fb_page_id → page picture).
const pageOf = (o) => ({ account_name: o?.page_name, fb_page_id: o?.page_fb_id });

/**
 * Month calendar showing how many posts are scheduled on each day.
 * Empty upcoming days (no post set yet) are highlighted as "open".
 */
export default function CalendarMonth({ posts = [], onPostsChanged }) {
  const toast = useToast();
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [noteCounts, setNoteCounts] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [draggingNote, setDraggingNote] = useState(null);
  const [dragSourceCount, setDragSourceCount] = useState(0); // notes in the note's day at drag start
  const [dragOverKey, setDragOverKey] = useState(null);
  const [notesRefreshToken, setNotesRefreshToken] = useState(0);
  const [creatingForDate, setCreatingForDate] = useState(null);

  // Per-day note counts for the visible month → drives the calendar's note badges.
  useEffect(() => {
    let active = true;
    notesService
      .monthCounts(view.year, view.month + 1)
      .then((c) => {
        if (active) setNoteCounts(c);
      })
      .catch(() => {
        if (active) setNoteCounts({});
      });
    return () => {
      active = false;
    };
  }, [view.year, view.month]);

  // Re-pull counts after the day modal adds/deletes a note (so badges stay live).
  const refreshNoteCounts = () => {
    notesService
      .monthCounts(view.year, view.month + 1)
      .then(setNoteCounts)
      .catch(() => {});
  };

  // A note dragged from the day dialog and dropped on `targetKey` moves to that
  // day. Refreshes the badges and tells the open dialog to drop the moved note.
  // If it was the open day's LAST note, follow it: re-open the dialog on the day it
  // landed on (rather than leaving an empty dialog behind).
  const moveNote = async (note, targetKey) => {
    if (!note || targetKey === note.note_date) return;
    const wasLastInOpenDay = selectedDate === note.note_date && dragSourceCount <= 1;
    try {
      await notesService.setDate(note.id, targetKey);
      toast.success('Note moved');
      refreshNoteCounts();
      if (wasLastInOpenDay) {
        setSelectedDate(targetKey); // reloads the dialog for the destination day
      } else {
        setNotesRefreshToken((t) => t + 1); // just refresh the still-open dialog
      }
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  // Bucket scheduled posts by their LOCAL calendar day → drives both the per-day
  // count badges and the list shown in the day dialog.
  const postsByDay = useMemo(() => {
    const map = {};
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const d = new Date(p.scheduled_at);
      if (Number.isNaN(d.getTime())) continue;
      const k = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
      if (!map[k]) map[k] = [];
      map[k].push(p);
    }
    return map;
  }, [posts]);
  const counts = useMemo(() => {
    const m = {};
    for (const k of Object.keys(postsByDay)) m[k] = postsByDay[k].length;
    return m;
  }, [postsByDay]);

  // The selected day's posts (earliest first) — shown alongside notes in the dialog.
  const dayPosts = selectedDate
    ? (postsByDay[selectedDate] || []).slice().sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    : [];

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
        <div className="calendar__title">
          {MONTHS[month]} {year}
        </div>
        <div className="calendar__nav">
          <button
            className="btn btn--subtle btn--sm"
            onClick={() => setView({ year: today.getFullYear(), month: today.getMonth() })}
          >
            Today
          </button>
          <button className="btn btn--ghost btn--icon" onClick={() => go(-1)} aria-label="Previous month">
            ‹
          </button>
          <button className="btn btn--ghost btn--icon" onClick={() => go(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </div>

      <div className="calendar__grid calendar__dow">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar__dowcell">
            {w}
          </div>
        ))}
      </div>

      <div className="calendar__grid calendar__grid--days">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="calendar__cell calendar__cell--blank" />;
          const k = keyOf(year, month, d);
          const count = counts[k] || 0;
          const cellPosts = postsByDay[k] || [];
          const cell = new Date(year, month, d);
          const isPast = cell < todayMidnight;
          const isToday = k === todayKey;
          const isOpen = count === 0 && !isPast; // no post set yet (upcoming)
          const noteEntry = noteCounts[k];
          const noteCount = noteEntry?.count || 0;
          const noteChips = noteEntry?.notes || [];
          const cls = [
            'calendar__cell',
            count > 0 && 'is-scheduled',
            isToday && 'is-today',
            isOpen && 'is-open',
            isPast && count === 0 && 'is-past',
            noteCount > 0 && 'has-notes',
            draggingNote && dragOverKey === k && 'is-drop-target',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={k}
              className={cls}
              role="button"
              tabIndex={0}
              title="Plan content for this day"
              onClick={() => setSelectedDate(k)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedDate(k);
                }
              }}
              onDragOver={(e) => {
                if (!draggingNote) return;
                e.preventDefault(); // allow drop
                e.dataTransfer.dropEffect = 'move';
                // Drive the highlight from dragover alone (each cell overwrites the
                // active key) — avoids the dragenter/dragleave child-bubbling flicker.
                if (dragOverKey !== k) setDragOverKey(k);
              }}
              onDrop={(e) => {
                if (!draggingNote) return;
                e.preventDefault();
                const note = draggingNote;
                setDragOverKey(null);
                moveNote(note, k);
              }}
            >
              <span className="calendar__day">{d}</span>
              {noteChips.length > 0 && (
                <div className="calendar__notechips">
                  {/* Each note: page logo (leading) + a two-row column (title, status).
                      The month feed caps this at 3 (CHIPS_PER_DAY); the rest collapse
                      into a "+N more notes" row below. */}
                  {noteChips.map((n, idx) => (
                    <div
                      key={idx}
                      className={`calnote calnote--${n.status || 'pending'}`}
                      style={n.color ? { background: n.color, borderColor: n.color } : undefined}
                      title={`${n.text}${n.page_name ? ` · ${n.page_name}` : ''}`}
                    >
                      <PageAvatar page={pageOf(n)} className="calnote__logo" />
                      <span className="calnote__col">
                        <span className="calnote__title" style={n.text_color ? { color: n.text_color } : undefined}>
                          {n.text}
                        </span>
                        <span className="calnote__status">
                          <i className={`status-dot status-dot--${n.status || 'pending'}`} />
                          {statusLabel(n.status)}
                        </span>
                      </span>
                    </div>
                  ))}
                  {noteCount > noteChips.length && (
                    <span className="calnote-more">
                      +{noteCount - noteChips.length} more {noteCount - noteChips.length === 1 ? 'note' : 'notes'}
                    </span>
                  )}
                </div>
              )}
              {count > 0 && (
                <span className="calendar__thumbs" title={`${count} post${count === 1 ? '' : 's'} scheduled`}>
                  {cellPosts.slice(0, 3).map((p, idx) => (
                    <span
                      className="calendar__thumb"
                      key={p.id}
                      style={{ zIndex: 5 - idx }}
                      title={p.page_name || undefined}
                    >
                      {p.thumbnail_preview_url ? (
                        // Optimized still — no clip download just to fill a cell.
                        <img src={p.thumbnail_preview_url} alt="" />
                      ) : p.media_preview_url ? (
                        p.media_type === 'video' ? (
                          <video src={p.media_preview_url} muted preload="metadata" />
                        ) : (
                          <img src={p.media_preview_url} alt="" />
                        )
                      ) : (
                        <span className="calendar__thumb-ph" aria-hidden="true">📝</span>
                      )}
                      {/* Cross-page calendar → tag each post with its owning page. */}
                      {p.page_fb_id && (
                        <PageAvatar page={pageOf({ page_name: p.page_name, page_fb_id: p.page_fb_id })} className="calendar__thumb-page" />
                      )}
                    </span>
                  ))}
                  {count > 3 && <span className="calendar__thumb calendar__thumb--more">+{count - 3}</span>}
                </span>
              )}
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
        <span>
          <i className="dot dot--notes" /> has notes
        </span>
      </div>

      <DayNotesModal
        dateKey={selectedDate}
        hidden={!!creatingForDate}
        dragging={!!draggingNote}
        refreshToken={notesRefreshToken}
        posts={dayPosts}
        onCreatePost={(k) => setCreatingForDate(k)}
        onClose={() => setSelectedDate(null)}
        onChanged={refreshNoteCounts}
        onNoteDragStart={(note, count) => {
          setDraggingNote(note);
          setDragSourceCount(count || 0);
        }}
        onNoteDragEnd={() => {
          setDraggingNote(null);
          setDragOverKey(null);
        }}
      />

      <CreatePostModal
        dateKey={creatingForDate}
        onClose={() => setCreatingForDate(null)}
        onCreated={() => {
          setCreatingForDate(null);
          onPostsChanged?.(); // refresh dashboard data so the new post shows
        }}
      />
    </div>
  );
}
