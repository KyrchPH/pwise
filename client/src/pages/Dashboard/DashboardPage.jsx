import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import * as settingsService from '../../services/settings.service.js';
import { apiError } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, Button, StatusBadge } from '../../components/ui.jsx';

const STAT_DEFS = [
  { key: 'total', label: 'Total posts', color: 'var(--primary)' },
  { key: 'ready', label: 'Ready', color: 'var(--success)' },
  { key: 'posted', label: 'Posted', color: 'var(--accent)' },
  { key: 'failed', label: 'Failed', color: 'var(--danger)' },
  { key: 'draft', label: 'Drafts', color: 'var(--muted)' },
];

function formatInterval(min) {
  if (!min) return '—';
  if (min % 1440 === 0) return `every ${min / 1440}d`;
  if (min % 60 === 0) return `every ${min / 60}h`;
  return `every ${min}m`;
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : '—');

export default function DashboardPage() {
  const toast = useToast();
  const [counts, setCounts] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([postPool.counts(), settingsService.get()])
      .then(([c, s]) => {
        setCounts(c);
        setSettings(s);
      })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Spinner label="Loading dashboard…" />;
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
              <span className="text-muted">Posting interval</span>
              <strong>{formatInterval(settings.posting_interval_minutes)}</strong>
            </div>
            <div className="row row--between">
              <span className="text-muted">Allowed window</span>
              <strong>
                {hhmm(settings.allowed_start_time)} – {hhmm(settings.allowed_end_time)}
              </strong>
            </div>
            <div className="row row--between">
              <span className="text-muted">Timezone</span>
              <strong>{settings.timezone}</strong>
            </div>
            <div className="row row--between">
              <span className="text-muted">Low-pool threshold</span>
              <strong>{settings.low_pool_alert_threshold}</strong>
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
    </>
  );
}
