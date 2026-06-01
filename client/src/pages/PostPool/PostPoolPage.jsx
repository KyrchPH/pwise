import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Card, Spinner, StatusBadge, EmptyState, Modal, Field, MediaThumb } from '../../components/ui.jsx';

const FILTERS = ['all', 'ready', 'posting', 'posted', 'failed', 'archived'];

const pad = (n) => String(n).padStart(2, '0');

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
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (status) => {
      setLoading(true);
      try {
        const params = status && status !== 'all' ? { status } : {};
        setPosts(await postPool.list(params));
      } catch (e) {
        toast.error(apiError(e));
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(filter);
  }, [filter, load]);

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
      load(filter);
    } catch (err) {
      setEditError(apiError(err)); // e.g. duplicate-slot conflict
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await postPool.remove(deleting.id);
      toast.success('Post deleted');
      setDeleting(null);
      load(filter);
    } catch (e) {
      toast.error(apiError(e));
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
            <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
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
            <Card key={post.id} className="post-card">
              <MediaThumb mediaUrl={post.media_url} mediaType={post.media_type} />
              <div className="post-card__body">
                <div className="row row--between">
                  <StatusBadge status={post.status} />
                  <span className="text-sm text-muted">#{post.id}</span>
                </div>
                <div className="post-card__caption">{post.caption || <em className="text-muted">No caption</em>}</div>
                {post.scheduled_at && <div className="post-card__sched">📅 {fmtSched(post.scheduled_at)}</div>}
              </div>
              <div className="post-card__actions">
                <Button variant="subtle" size="sm" onClick={() => openEdit(post)}>
                  Edit
                </Button>
                <div className="toolbar__spacer" />
                <Button variant="danger" size="sm" onClick={() => setDeleting(post)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

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
                <input
                  className="input"
                  type="time"
                  step="1800"
                  value={editing._schedTime || ''}
                  onChange={editField('_schedTime')}
                />
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
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        Are you sure you want to delete post <strong>#{deleting?.id}</strong>? This can't be undone.
      </Modal>
    </>
  );
}
