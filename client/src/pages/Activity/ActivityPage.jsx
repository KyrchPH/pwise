import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as activityService from '../../services/activity.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, EmptyState, Button } from '../../components/ui.jsx';

const fmt = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

// Map an action to one of the existing status badge styles.
const ACTION = {
  created: { label: 'Created', badge: 'ready' },
  edited: { label: 'Edited', badge: 'draft' },
  deleted: { label: 'Deleted', badge: 'failed' },
};

export default function ActivityPage() {
  const toast = useToast();
  const { data: items = [], loading, error } = useCachedResource('activity', () => activityService.list());

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Activity Log</h1>
          <div className="page-head__sub">Who created, edited, or deleted each post.</div>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading activity…" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="📝"
            title="No activity yet"
            message="Creating, editing, or deleting a post will show up here."
            action={
              <Button as={Link} to="/post-pool" variant="subtle">
                Go to post pool
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Post / details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const meta = ACTION[a.action] || { label: a.action, badge: 'draft' };
                  return (
                    <tr key={a.id}>
                      <td className="cell-muted">{fmt(a.created_at)}</td>
                      <td>{a.user_name || '—'}</td>
                      <td>
                        <span className={`badge badge--${meta.badge}`}>{meta.label}</span>
                      </td>
                      <td className="cell-truncate" title={a.details || ''}>
                        {a.post_id ? `#${a.post_id} ` : ''}
                        {a.details || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
