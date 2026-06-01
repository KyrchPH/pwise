import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Card, Spinner, StatusBadge, EmptyState, Modal, Field, MediaThumb } from '../../components/ui.jsx';

const FILTERS = ['all', 'draft', 'ready', 'posting', 'posted', 'failed', 'archived'];
const STATUS_OPTIONS = ['draft', 'ready', 'posting', 'posted', 'failed', 'archived'];
const PLATFORMS = ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'];

export default function PostPoolPage() {
  const toast = useToast();
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
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

  const quickStatus = async (post, status) => {
    try {
      await postPool.update(post.id, { status });
      toast.success(`Marked as ${status}`);
      load(filter);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await postPool.update(editing.id, {
        caption: editing.caption,
        status: editing.status,
        priority: Number(editing.priority) || 0,
        target_platform: editing.target_platform,
      });
      toast.success('Post updated');
      setEditing(null);
      load(filter);
    } catch (err) {
      toast.error(apiError(err));
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
                  <span className="text-sm text-muted">P{post.priority}</span>
                </div>
                <div className="post-card__caption">{post.caption || <em className="text-muted">No caption</em>}</div>
                <div className="post-card__meta">
                  <span>{post.target_platform || 'no platform'}</span>
                  <span>#{post.id}</span>
                </div>
              </div>
              <div className="post-card__actions">
                <Button variant="subtle" size="sm" onClick={() => setEditing({ ...post })}>
                  Edit
                </Button>
                {post.status === 'draft' && (
                  <Button variant="ghost" size="sm" onClick={() => quickStatus(post, 'ready')}>
                    Mark ready
                  </Button>
                )}
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
            <div className="grid-2">
              <Field label="Status">
                <select className="select" value={editing.status} onChange={editField('status')}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <input
                  className="input"
                  type="number"
                  value={editing.priority ?? 0}
                  onChange={editField('priority')}
                />
              </Field>
            </div>
            <Field label="Target platform">
              <select className="select" value={editing.target_platform || ''} onChange={editField('target_platform')}>
                <option value="">— none —</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
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
