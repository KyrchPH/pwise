import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { Button, Card, Spinner, StatusBadge, EmptyState, Modal, Field, MediaThumb, TimeSelect, Dropdown, PageAvatar, HeartIcon, CommentIcon, ShareIcon, EyeIcon } from '../../components/ui.jsx';
import PostViewer from '../../components/PostViewer.jsx';

const FILTERS = ['all', 'ready', 'posting', 'posted', 'failed', 'archived', 'expired', 'deleted'];

const PAGE_SIZE = 15;

const pad = (n) => String(n).padStart(2, '0');

// Compact counts: 1234 -> "1.2k", 1_500_000 -> "1.5M".
const fmtNum = (n) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
};

// Split a stored UTC ISO into local date/time inputs.
function schedToParts(iso) {
  if (!iso) return { _schedDate: '', _schedTime: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { _schedDate: '', _schedTime: '' };
  return {
    _schedDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    _schedTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function fmtSched(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Relative "time ago" for when a post went out — mirrors the Instagram-style
// "21 hours ago". Falls back to an absolute date once it's older than a month.
function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Total watch time (seconds) → compact human duration: "3h 12m", "45m", "3m 20s", "48s".
function fmtWatch(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return sec ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}

// Average play time (seconds) → a clock: "0:08", "1:23".
function fmtClock(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// "1,234 reactions" / "1 reaction" — count + singular/plural label.
const countLabel = (n, word) => `${fmtNum(n)} ${word}${Number(n) === 1 ? '' : 's'}`;

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export default function PostPoolPage() {
  const toast = useToast();
  const { activePage } = usePages();
  const [filter, setFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(''); // posted-date range (YYYY-MM-DD, inclusive)
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(null); // id of the post currently being retried
  const [menuPostId, setMenuPostId] = useState(null);
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const dateMenuRef = useRef(null);
  // "Export Analytics Data" dialog — a PDF of posts in a chosen date range.
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStart, setExportStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [exportEnd, setExportEnd] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  // Local day boundaries → UTC ISO, so the server compares against posted_at (UTC)
  // without timezone skew. `from` = start of that day, `to` = end of that day.
  const fromIso = dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : '';
  const toIso = dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : '';

  const {
    data,
    loading,
    error,
    refresh,
  } = useCachedResource(`post-pool:list:${filter}:${fromIso}:${toIso}:p${page}`, () =>
    postPool.list({
      ...(filter !== 'all' ? { status: filter } : {}),
      ...(fromIso ? { from: fromIso } : {}),
      ...(toIso ? { to: toIso } : {}),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      refresh: 1, // re-read this page's engagement from Facebook on load
    }),
  );
  const posts = data?.posts ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Surface fetch failures as a toast (any cached posts stay on screen).
  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  // If the current page drifts out of range (e.g. deletes shrink the pool), step
  // back onto the last page that still exists.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (menuPostId == null) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && e.target.closest('.post-card__menu')) return;
      setMenuPostId(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuPostId]);

  useEffect(() => {
    if (!dateMenuOpen) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && dateMenuRef.current?.contains(e.target)) return;
      setDateMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [dateMenuOpen]);

  // After a change: drop sibling caches (other filters + dashboard counts) so
  // they refetch when next visited, and refetch the current view now.
  const reload = () => {
    invalidateCache('post-pool');
    invalidateCache('dashboard');
    refresh();
  };

  const openEdit = (post) => {
    setEditError(null);
    setEditing({ ...post, ...schedToParts(post.scheduled_at) });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setEditError(null);
    // A published post can't be rescheduled — only its caption is editable (and the
    // server pushes that edit to Facebook). So don't send, or require, a schedule for
    // it; a schedule only applies to a post that hasn't gone out yet.
    const payload = { caption: editing.caption };
    if (editing.status !== 'posted') {
      if ((editing._schedDate && !editing._schedTime) || (!editing._schedDate && editing._schedTime)) {
        setEditError('Pick both a date and a time to schedule (or clear both).');
        return;
      }
      payload.scheduled_at =
        editing._schedDate && editing._schedTime
          ? new Date(`${editing._schedDate}T${editing._schedTime}`).toISOString()
          : null;
    }

    setSaving(true);
    try {
      await postPool.update(editing.id, payload);
      toast.success('Post updated');
      setEditing(null);
      reload();
    } catch (err) {
      setEditError(apiError(err)); // e.g. duplicate-slot conflict
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deletingBusy) return; // guard against double-clicks
    setDeletingBusy(true);
    try {
      await postPool.remove(deleting.id);
      toast.success('Post deleted');
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDeletingBusy(false);
    }
  };

  // Retry a failed/expired post: re-publish it now via the webhook (ignores the
  // schedule, so a passed time is fine). It flips to 'posting' immediately; n8n
  // reports the final result back, so a later refresh shows posted/failed.
  const retryPost = async (post) => {
    if (retrying) return false; // one at a time; guards double-clicks
    setRetrying(post.id);
    try {
      await postPool.retry(post.id);
      toast.success('Retrying — publishing now');
      reload();
      return true;
    } catch (e) {
      toast.error(apiError(e));
      return false;
    } finally {
      setRetrying(null);
    }
  };

  const editField = (key) => (e) => setEditing((p) => ({ ...p, [key]: e.target.value }));

  // Page through every posted item, keep those published in the chosen window, and
  // render a PDF analytics report from them.
  const runExport = async () => {
    if (exporting) return;
    if (!exportStart || !exportEnd || exportStart > exportEnd) {
      toast.error('Pick a valid start and end date');
      return;
    }
    setExporting(true);
    try {
      const startMs = new Date(`${exportStart}T00:00:00`).getTime();
      const endMs = new Date(`${exportEnd}T23:59:59.999`).getTime();
      const all = [];
      const LIMIT = 200;
      for (let offset = 0; ; offset += LIMIT) {
        const res = await postPool.list({ status: 'posted', limit: LIMIT, offset });
        all.push(...(res.posts || []));
        if (!res.posts?.length || all.length >= (res.total || 0) || all.length >= 2000) break;
      }
      const inRange = all.filter((p) => {
        const t = new Date(p.posted_at).getTime();
        return !Number.isNaN(t) && t >= startMs && t <= endMs;
      });
      if (!inRange.length) {
        toast.error('No posted content in that date range');
        return;
      }
      const { buildRangeAnalyticsPdf, loadLogo } = await import('../../utils/reportPdf.js');
      const logo = await loadLogo();
      const doc = buildRangeAnalyticsPdf({
        start: new Date(`${exportStart}T00:00:00`),
        end: new Date(`${exportEnd}T00:00:00`),
        posts: inRange,
        pageName: activePage?.account_name || null,
        logo,
      });
      doc.save(`analytics-${exportStart}_to_${exportEnd}.pdf`);
      setExportOpen(false);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setExporting(false);
    }
  };

  // Identity shown in each card's Instagram-style header.
  const pageName = activePage?.account_name || 'Your Page';

  return (
    <>
      <div className="page-head contents-head">
        <div>
          <h1 className="page-head__title">Contents</h1>
          <div className="page-head__sub">All uploaded content the agent can publish.</div>
        </div>
        <div className="row contents-head__actions">
          <div className="contents-head__filters">
            <Dropdown
              ariaLabel="Filter by status"
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
              options={FILTERS.map((f) => ({
                value: f,
                label: f === 'all' ? 'All statuses' : f.charAt(0).toUpperCase() + f.slice(1),
              }))}
            />
            <div className="toolbar__dates contents-toolbar__dates" ref={dateMenuRef}>
              <button
                type="button"
                className={`contents-toolbar__calendar${dateFrom || dateTo ? ' is-active' : ''}`}
                onClick={() => setDateMenuOpen((open) => !open)}
                aria-label="Filter by date range"
                aria-haspopup="menu"
                aria-expanded={dateMenuOpen}
                title="Filter by date range"
              >
                <CalendarIcon />
              </button>
              {dateMenuOpen && (
                <div className="contents-toolbar__menu" role="menu" aria-label="Date range filter">
                  <div className="contents-toolbar__range" aria-label="Date range">
                    <label className={`toolbar__date contents-toolbar__date${dateFrom ? ' has-value' : ''}`} data-placeholder="From">
                      <input
                        className="input"
                        type="date"
                        aria-label="From date"
                        placeholder="From"
                        value={dateFrom}
                        max={dateTo || undefined}
                        onChange={(e) => {
                          setDateFrom(e.target.value);
                          setPage(1);
                        }}
                      />
                    </label>
                    <label className={`toolbar__date contents-toolbar__date${dateTo ? ' has-value' : ''}`} data-placeholder="To">
                      <input
                        className="input"
                        type="date"
                        aria-label="To date"
                        placeholder="To"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={(e) => {
                          setDateTo(e.target.value);
                          setPage(1);
                        }}
                      />
                    </label>
                  </div>
                  {(dateFrom || dateTo) && (
                    <button
                      type="button"
                      className="contents-toolbar__clear"
                      onClick={() => {
                        setDateFrom('');
                        setDateTo('');
                        setPage(1);
                      }}
                    >
                      Clear dates
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <Button variant="ghost" onClick={() => setExportOpen(true)}>
            Export Analytics Data
          </Button>
          <Button as={Link} to="/upload">
            + Upload post
          </Button>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading posts…" />
      ) : posts.length === 0 ? (
        <Card>
          <EmptyState
            icon="🗂️"
            title="No posts here"
            message={
              dateFrom || dateTo
                ? 'No posts published in that date range. Try widening or clearing the dates.'
                : filter === 'all'
                  ? 'Upload your first post to get started.'
                  : `No posts with status "${filter}".`
            }
            action={
              <Button as={Link} to="/upload">
                Upload a post
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid--cards">
          {posts.map((post) => (
            <Card
              key={post.id}
              className="post-card post-card--ig post-card--clickable"
              role="button"
              tabIndex={0}
              onClick={() => setViewing(post)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setViewing(post);
                }
              }}
            >
              {/* Instagram-style header: avatar + page name on the left, status + ⋮ on the right */}
              <div className="post-card__head">
                <span className="post-card__avatar" aria-hidden="true">
                  {/* Real page picture inside the IG-style ring (letter fallback). */}
                  <PageAvatar page={activePage} className="post-card__avatar-img" />
                </span>
                <span className="post-card__name">{pageName}</span>
                <div className="post-card__head-right" onClick={(e) => e.stopPropagation()}>
                  <StatusBadge status={post.status} />
                  <div className="post-card__menu">
                    <button
                      type="button"
                      className="post-card__menu-trigger"
                      aria-label="Post options"
                      title="Post options"
                      aria-expanded={menuPostId === post.id}
                      onClick={() => setMenuPostId((id) => (id === post.id ? null : post.id))}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="19" cy="12" r="2" />
                      </svg>
                    </button>
                    {menuPostId === post.id && (
                      <div className="card-menu post-card__dropdown" role="menu">
                        <button
                          type="button"
                          className="card-menu__item"
                          role="menuitem"
                          onClick={() => {
                            setMenuPostId(null);
                            openEdit(post);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="card-menu__item card-menu__item--danger"
                          role="menuitem"
                          onClick={() => {
                            setMenuPostId(null);
                            setDeleting(post);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <MediaThumb mediaUrl={post.media_preview_url} mediaType={post.media_type} thumbnailUrl={post.thumbnail_preview_url} />

              <div className="post-card__body">
                {/* Engagement icons + counts (published, synced posts only) */}
                {post.engagement_synced_at && (
                  <>
                    <div className="post-card__actions">
                      <span className="post-card__act" title="Reactions"><HeartIcon size={22} /></span>
                      <span className="post-card__act" title="Comments"><CommentIcon size={22} /></span>
                      <span className="post-card__act" title="Shares"><ShareIcon size={22} /></span>
                    </div>
                    <div className="post-card__likes">{countLabel(post.reactions_count, 'reaction')}</div>
                  </>
                )}

                {/* Caption — prefixed with the page name, Instagram-style */}
                <div className="post-card__caption">
                  {post.caption ? (
                    <>
                      <span className="post-card__cap-name">{pageName}</span> {post.caption}
                    </>
                  ) : (
                    <em className="text-muted">No caption</em>
                  )}
                </div>

                {/* Secondary counts (replaces IG's "View all N comments") */}
                {post.engagement_synced_at && (
                  <div className="post-card__meta-counts">
                    <span>{countLabel(post.comments_count, 'comment')}</span>
                    <span>·</span>
                    <span>{countLabel(post.shares_count, 'share')}</span>
                    {post.media_type === 'video' && post.views_count != null && (
                      <>
                        <span>·</span>
                        <span>{countLabel(post.views_count, 'view')}</span>
                      </>
                    )}
                  </div>
                )}

                {/* Video watch metrics — only when Facebook returned them */}
                {post.media_type === 'video' && (post.video_watch_time_s != null || post.video_avg_watch_s != null) && (
                  <div className="post-card__vstats">
                    {post.video_watch_time_s != null && (
                      <span title="Total watch time across all views">
                        <EyeIcon size={14} /> {fmtWatch(post.video_watch_time_s)} watched
                      </span>
                    )}
                    {post.video_avg_watch_s != null && (
                      <span title="Average time watched per view">avg {fmtClock(post.video_avg_watch_s)}</span>
                    )}
                  </div>
                )}

                {/* Bottom timestamp — "21 hours ago" when posted, else the scheduled slot */}
                {post.posted_at ? (
                  <div className="post-card__time" title={fmtSched(post.posted_at)}>{timeAgo(post.posted_at)}</div>
                ) : post.scheduled_at ? (
                  <div className="post-card__time">📅 {fmtSched(post.scheduled_at)}</div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            ← Prev
          </Button>
          <span className="pagination__info">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next →
          </Button>
        </div>
      )}

      {/* Full-screen, Facebook-style post viewer */}
      <PostViewer
        post={viewing}
        onClose={() => setViewing(null)}
        onEdit={(p) => {
          setViewing(null);
          openEdit(p);
        }}
        onRetry={async (p) => {
          if (await retryPost(p)) setViewing(null);
        }}
        onDelete={async (p) => {
          try {
            await postPool.remove(p.id);
            toast.success('Post deleted');
            setViewing(null);
            reload();
          } catch (e) {
            toast.error(apiError(e));
          }
        }}
        onDeletedOnFacebook={() => reload()}
      />

      {/* Edit modal */}
      <Modal
        open={!!editing}
        title={`Edit post #${editing?.id ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {editing && (
          <form onSubmit={saveEdit}>
            <Field label="Caption">
              <textarea className="textarea" value={editing.caption || ''} onChange={editField('caption')} />
            </Field>
            {editing.status === 'posted' ? (
              <div className="field">
                <span className="field__label">Schedule</span>
                <span className="field__hint">
                  {editing.posted_at ? `Published ${fmtSched(editing.posted_at)}.` : 'Already published.'} A posted post
                  can’t be rescheduled — only its caption is editable.
                </span>
              </div>
            ) : (
              <div className="field">
                <span className="field__label">Schedule</span>
                <div className="grid-2">
                  <input className="input" type="date" value={editing._schedDate || ''} onChange={editField('_schedDate')} />
                  <TimeSelect value={editing._schedTime || ''} onChange={editField('_schedTime')} date={editing._schedDate} />
                </div>
                <span className="field__hint">Pick a future date and time. One post per slot.</span>
              </div>
            )}
            {editError && <div className="error-text">{editError}</div>}
          </form>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleting}
        title="Delete post"
        onClose={() => setDeleting(null)}
        dismissable={!deletingBusy}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deletingBusy}>
              {deletingBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        Are you sure you want to delete post <strong>#{deleting?.id}</strong>? This can't be undone.
      </Modal>

      {/* Export analytics as a PDF for a chosen date range */}
      <Modal
        open={exportOpen}
        title="Export Analytics Data"
        onClose={() => setExportOpen(false)}
        dismissable={!exporting}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportOpen(false)} disabled={exporting}>
              Cancel
            </Button>
            <Button className="btn--flat" onClick={runExport} disabled={exporting || !exportStart || !exportEnd || exportStart > exportEnd}>
              {exporting ? 'Preparing…' : 'Export PDF'}
            </Button>
          </>
        }
      >
        <p className="text-muted text-sm" style={{ marginTop: 0, marginBottom: 14 }}>
          Generate a PDF report of posts published in this window, with per-post engagement and totals.
        </p>
        <div className="grid-2">
          <Field label="Start date">
            <input className="input" type="date" value={exportStart} max={exportEnd || undefined} onChange={(e) => setExportStart(e.target.value)} />
          </Field>
          <Field label="End date">
            <input className="input" type="date" value={exportEnd} min={exportStart || undefined} onChange={(e) => setExportEnd(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
