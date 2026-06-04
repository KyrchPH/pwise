import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource, invalidateCache } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Card, Spinner, StatusBadge, EmptyState, Modal, Field, MediaThumb, TimeSelect, HeartIcon, CommentIcon, ShareIcon, EyeIcon } from '../../components/ui.jsx';
import PostViewer from '../../components/PostViewer.jsx';

const FILTERS = ['all', 'ready', 'posting', 'posted', 'failed', 'archived', 'expired'];

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
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [saving, setSaving] = useState(false);

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
    if ((editing._schedDate && !editing._schedTime) || (!editing._schedDate && editing._schedTime)) {
      setEditError('Pick both a date and a time to schedule (or clear both).');
      return;
    }
    const scheduled_at =
      editing._schedDate && editing._schedTime
        ? new Date(`${editing._schedDate}T${editing._schedTime}`).toISOString()
        : null;

    setSaving(true);
    try {
      await postPool.update(editing.id, { caption: editing.caption, scheduled_at });
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

  const editField = (key) => (e) => setEditing((p) => ({ ...p, [key]: e.target.value }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Post Pool</h1>
          <div className="page-head__sub">All uploaded content the agent can publish.</div>
        </div>
        <Button as={Link} to="/upload">
          + Upload post
        </Button>
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
              <MediaThumb mediaUrl={post.media_preview_url} mediaType={post.media_type} />
              <div className="post-card__body">
                <div className="row row--between">
                  <StatusBadge status={post.status} />
                  <span className="text-sm text-muted">#{post.id}</span>
                </div>
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
              {/* stopPropagation so the action buttons don't also open the viewer */}
              <div className="post-card__actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="card-iconbtn" onClick={() => openEdit(post)} aria-label="Edit post" title="Edit">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="card-iconbtn card-iconbtn--danger"
                  onClick={() => setDeleting(post)}
                  aria-label="Delete post"
                  title="Delete"
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
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
            <div className="field">
              <span className="field__label">Schedule (optional)</span>
              <div className="grid-2">
                <input className="input" type="date" value={editing._schedDate || ''} onChange={editField('_schedDate')} />
                <TimeSelect value={editing._schedTime || ''} onChange={editField('_schedTime')} date={editing._schedDate} />
              </div>
              <span className="field__hint">Clear both to fall back to the interval. One post per slot.</span>
            </div>
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
    </>
  );
}
