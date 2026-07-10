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

const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const TZ_SUFFIX_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function parseActivityDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const raw = value.trim();
    const normalized = SQL_DATETIME_RE.test(raw) && !TZ_SUFFIX_RE.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const fmt = (d) => {
  const date = parseActivityDate(d);
  return date ? date.toLocaleString() : '-';
};

// Relative for nearby timestamps; absolute timestamp once more than a week away.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const fmtWhen = (d) => {
  const date = parseActivityDate(d);
  if (!date) return '-';
  const diff = Date.now() - date.getTime();
  const absDiff = Math.abs(diff);
  if (absDiff >= WEEK_MS) return date.toLocaleString();
  const min = Math.floor(absDiff / 60000);
  if (min < 1) return 'Just now';
  const suffix = diff < 0 ? '' : ' ago';
  const prefix = diff < 0 ? 'in ' : '';
  if (min < 60) return `${prefix}${min}m${suffix}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${prefix}${hr}h${suffix}`;
  return `${prefix}${Math.floor(hr / 24)}d${suffix}`;
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
