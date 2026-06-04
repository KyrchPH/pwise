import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as analytics from '../../services/analytics.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, EmptyState } from '../../components/ui.jsx';
import LineChart from '../../components/LineChart.jsx';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 28, label: '28 days' },
  { days: 90, label: '90 days' },
];

const CHARTS = [
  { key: 'page_impressions_unique', label: 'Reach', color: '#1f9be6', hint: 'People who saw your page' },
  { key: 'page_post_engagements', label: 'Engagement', color: '#2fb457', hint: 'Reactions, comments, shares & clicks' },
  { key: 'page_daily_follows_unique', label: 'New follows', color: '#7c3aed', hint: 'New followers per day' },
];

const fmtNum = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
};
const sumSeries = (arr) => (arr || []).reduce((a, p) => a + (Number(p.value) || 0), 0);

export default function AnalyticsPage() {
  const toast = useToast();
  const [range, setRange] = useState(28);

  const { data, loading, error } = useCachedResource(`analytics:overview:${range}`, () => analytics.overview(range));

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  if (loading && !data) return <Spinner label="Loading analytics…" />;

  const series = data?.series || {};
  const hasData = CHARTS.some((c) => (series[c.key] || []).length > 0);

  const impressions = sumSeries(series.page_posts_impressions);
  const engagement = sumSeries(series.page_post_engagements);
  const netFollows = sumSeries(series.page_daily_follows_unique) - sumSeries(series.page_daily_unfollows_unique);

  const stats = [
    { label: 'Followers', value: data?.followers != null ? fmtNum(data.followers) : '—', color: 'var(--primary)' },
    { label: `Net followers · ${range}d`, value: `${netFollows >= 0 ? '+' : ''}${fmtNum(netFollows)}`, color: 'var(--success)' },
    { label: `Impressions · ${range}d`, value: fmtNum(impressions), color: 'var(--accent)' },
    { label: `Engagement · ${range}d`, value: fmtNum(engagement), color: 'var(--blue)' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Analytics</h1>
          <div className="page-head__sub">{data?.pageName || 'Your page performance over time.'}</div>
        </div>
        <div className="seg">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={`seg__btn ${range === r.days ? 'is-active' : ''}`}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid--stats">
        {stats.map((s) => (
          <Card key={s.label} className="stat">
            <div className="stat__label">
              <span className="stat__dot" style={{ background: s.color }} />
              {s.label}
            </div>
            <div className="stat__value">{s.value}</div>
          </Card>
        ))}
      </div>

      {!hasData ? (
        <Card className="card--pad mt-lg">
          <EmptyState
            icon="📊"
            title="No analytics yet"
            message="Once the snapshot job runs (or on first load) your page reach, engagement and follower charts will appear here."
          />
        </Card>
      ) : (
        <div className="analytics-charts mt-lg">
          {CHARTS.map((c) => (
            <Card key={c.key} className="card--pad">
              <div className="analytics-chart__head">
                <div className="analytics-chart__title">{c.label}</div>
                <div className="text-sm text-muted">{c.hint}</div>
              </div>
              <div className="analytics-chart__body">
                {(series[c.key] || []).length ? (
                  <LineChart points={series[c.key]} color={c.color} />
                ) : (
                  <div className="text-sm text-muted" style={{ padding: '24px 0' }}>
                    No data for this metric in this range.
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {data?.ranking?.length > 0 && (
        <Card className="card--pad mt-lg">
          <div className="analytics-chart__title" style={{ marginBottom: 12 }}>
            Top posts by engagement
          </div>
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Reactions</th>
                  <th>Comments</th>
                  <th>Shares</th>
                  <th>Engagement</th>
                </tr>
              </thead>
              <tbody>
                {data.ranking.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-truncate" data-label="Post">
                      <Link to="/post-pool">
                        #{p.id}
                        {p.caption ? ` — ${p.caption.slice(0, 60)}` : ''}
                      </Link>
                    </td>
                    <td data-label="Reactions">{fmtNum(p.reactions_count)}</td>
                    <td data-label="Comments">{fmtNum(p.comments_count)}</td>
                    <td data-label="Shares">{fmtNum(p.shares_count)}</td>
                    <td data-label="Engagement">
                      <strong>{fmtNum(p.engagement)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
