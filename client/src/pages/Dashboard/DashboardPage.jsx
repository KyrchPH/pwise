import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import * as settingsService from '../../services/settings.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, Button, StatusBadge } from '../../components/ui.jsx';
import CalendarMonth from '../../components/CalendarMonth.jsx';

const STAT_DEFS = [
  { key: 'total', label: 'Total posts', color: 'var(--primary)' },
  { key: 'ready', label: 'Ready', color: 'var(--success)' },
  { key: 'posted', label: 'Posted', color: 'var(--accent)' },
  { key: 'failed', label: 'Failed', color: 'var(--danger)' },
  { key: 'draft', label: 'Drafts', color: 'var(--muted)' },
];

export default function DashboardPage() {
  const toast = useToast();
  const { data, loading, error, refresh } = useCachedResource('dashboard', () =>
    Promise.all([postPool.counts(), settingsService.get(), postPool.list({ scheduled: 1 })]).then(
      ([counts, settings, scheduled]) => ({ counts, settings, scheduled: scheduled.posts }),
    ),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  const { counts, settings, scheduled = [] } = data || {};

  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  if (!counts || !settings) return null;

  const enabled = !!settings.is_enabled;
  const lowPool = counts.ready <= settings.low_pool_alert_threshold;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Dashboard</h1>
          <div className="page-head__sub">Overview of your automated posting.</div>
        </div>
        <Button as={Link} to="/upload">
          + Upload post
        </Button>
      </div>

      {lowPool && (
        <div className="banner banner--warning">
          ⚠️ Low pool: only <strong>&nbsp;{counts.ready}&nbsp;</strong> ready post(s) left (alert threshold is{' '}
          {settings.low_pool_alert_threshold}). Add more before the agent runs dry.
        </div>
      )}

      <div className="grid grid--stats">
        {STAT_DEFS.map((s) => (
          <Card key={s.key} className="stat">
            <div className="stat__label">
              <span className="stat__dot" style={{ background: s.color }} />
              {s.label}
            </div>
            <div className="stat__value">{counts[s.key] ?? 0}</div>
          </Card>
        ))}
      </div>

      <div className="grid-2 mt-lg">
        <Card>
          <div className="card__head">
            <div className="card__title">Automation</div>
            <span className={`badge badge--${enabled ? 'ready' : 'archived'}`}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="card--pad col gap-sm">
            <div className="row row--between">
              <span className="text-muted">Timezone</span>
              <strong>{settings.timezone}</strong>
            </div>
            <div className="row row--between">
              <span className="text-muted">Scheduled posts</span>
              <strong>{scheduled.length}</strong>
            </div>
            <Button as={Link} to="/settings" variant="subtle" size="sm" className="mt-lg">
              Edit settings
            </Button>
          </div>
        </Card>

        <Card>
          <div className="card__head">
            <div className="card__title">Pipeline</div>
          </div>
          <div className="card--pad col gap-sm">
            {['posting', 'archived'].map((k) => (
              <div className="row row--between" key={k}>
                <StatusBadge status={k} />
                <strong>{counts[k] ?? 0}</strong>
              </div>
            ))}
            <div className="row row--between">
              <span className="text-muted">Ready to publish</span>
              <strong style={{ color: 'var(--success)' }}>{counts.ready}</strong>
            </div>
            <div className="row gap-sm mt-lg row--wrap">
              <Button as={Link} to="/post-pool" variant="subtle" size="sm">
                Manage pool
              </Button>
              <Button as={Link} to="/logs" variant="ghost" size="sm">
                View logs
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card className="card--pad mt-lg">
        <div className="row row--between" style={{ marginBottom: 16 }}>
          <div className="card__title">Content calendar</div>
          <span className="text-sm text-muted">Open days have no post scheduled yet</span>
        </div>
        <CalendarMonth posts={scheduled} onPostsChanged={refresh} />
      </Card>
    </>
  );
}
