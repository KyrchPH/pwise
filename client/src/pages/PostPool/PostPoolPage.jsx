import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePages } from '../../context/PageContext.jsx';
import { Button, Card, Spinner, StatusBadge, EmptyState, Modal, Field, MediaThumb, TimeSelect, HeartIcon, CommentIcon, ShareIcon, EyeIcon } from '../../components/ui.jsx';
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

export default function PostPoolPage() {
  const toast = useToast();
  const { activePage } = usePages();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(null); // id of the post currently being retried
  const [menuPostId, setMenuPostId] = useState(null);
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

  const {
    data,
    loading,
    error,
    refresh,
  } = useCachedResource(`post-pool:list:${filter}:p${page}`, () =>
    postPool.list({
      ...(filter !== 'all' ? { status: filter } : {}),
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Post Pool</h1>
          <div className="page-head__sub">All uploaded content the agent can publish.</div>
        </div>
        <div className="row">
          <Button variant="ghost" onClick={() => setExportOpen(true)}>
            Export Analytics Data
          </Button>
          <Button as={Link} to="/upload">
            + Upload post
          </Button>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`chip ${filter === f ? 'active' : ''}`}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading posts…" />
      ) : posts.length === 0 ? (
        <Card>
          <EmptyState
            icon="🗂️"
            title="No posts here"
            message={filter === 'all' ? 'Upload your first post to get started.' : `No posts with status "${filter}".`}
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
              className="post-card post-card--clickable"
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
              <MediaThumb mediaUrl={post.media_preview_url} mediaType={post.media_type} thumbnailUrl={post.thumbnail_preview_url}>
                <div className="post-card__status">
                  <StatusBadge status={post.status} />
                </div>
                <div className="post-card__menu" onClick={(e) => e.stopPropagation()}>
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
              </MediaThumb>
              <div className="post-card__body">
                <div className="post-card__caption">{post.caption || <em className="text-muted">No caption</em>}</div>
                {post.scheduled_at && <div className="post-card__sched">📅 {fmtSched(post.scheduled_at)}</div>}
                {post.engagement_synced_at && (
                  <div className="post-card__stats">
                    <span title="Reactions"><HeartIcon size={14} />{fmtNum(post.reactions_count)}</span>
                    <span title="Comments"><CommentIcon size={14} />{fmtNum(post.comments_count)}</span>
                    <span title="Shares"><ShareIcon size={14} />{fmtNum(post.shares_count)}</span>
                    {post.media_type === 'video' && <span title="Views"><EyeIcon size={14} />{fmtNum(post.views_count)}</span>}
                  </div>
                )}
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
