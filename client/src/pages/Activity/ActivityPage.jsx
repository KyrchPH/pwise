import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as activityService from '../../services/activity.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, EmptyState, Button } from '../../components/ui.jsx';

const PAGE_SIZE = 10;

function ChevronIcon({ direction }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

const fmt = (d) => {
  if (!d) return '-';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

// Relative for the last week; absolute timestamp once older or in the future.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const fmtWhen = (d) => {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = Date.now() - date.getTime();
  if (diff < 0 || diff >= WEEK_MS) return date.toLocaleString();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};

// Map an action to one of the existing status badge styles.
const ACTION = {
  created: { label: 'Created', badge: 'ready' },
  edited: { label: 'Edited', badge: 'draft' },
  tagged: { label: 'Tagged', badge: 'posting' },
  deleted: { label: 'Deleted', badge: 'failed' },
};

export default function ActivityPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useCachedResource(`activity:p${page}`, () =>
    activityService.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  );

  const items = data?.activity ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Activity Log</h1>
          <div className="page-head__sub">Who created, edited, tagged, or deleted each post and content note.</div>
        </div>
      </div>

      {loading ? (
        <Card className="log-table-card log-table-card--state">
          <Spinner label="Loading activity..." />
        </Card>
      ) : items.length === 0 ? (
        <Card className="log-table-card log-table-card--state">
          <EmptyState
            icon="Log"
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
        <Card className="log-table-card">
          <div className="table-wrap log-table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Item / details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const meta = ACTION[a.action] || { label: a.action, badge: 'draft' };
                  return (
                    <tr key={a.id}>
                      <td className="cell-muted" data-label="When" title={fmt(a.created_at)}>
                        {fmtWhen(a.created_at)}
                      </td>
                      <td data-label="User">{a.user_name || '-'}</td>
                      <td data-label="Action">
                        <span className={`badge badge--${meta.badge}`}>{meta.label}</span>
                      </td>
                      <td className="cell-truncate" data-label="Details">
                        {a.note_id ? 'Note ' : a.post_id ? `#${a.post_id} ` : ''}
                        {a.details || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination pagination--table">
              <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronIcon direction="left" />
                Prev
              </Button>
              <span className="pagination__info">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="ghost"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
                <ChevronIcon direction="right" />
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
