import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as analytics from '../../services/analytics.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, EmptyState } from '../../components/ui.jsx';
import BarChart from '../../components/BarChart.jsx';

const PERIODS = [
  { key: 'days', label: 'Days', hint: 'Past 14 days', range: 14, bucket: 'day', count: 14 },
  { key: 'weeks', label: 'Weeks', hint: 'Past 12 weeks', range: 84, bucket: 'week', count: 12 },
  { key: 'months', label: 'Months', hint: 'Past 12 months', range: 365, bucket: 'month', count: 12 },
  { key: 'years', label: 'Years', hint: 'Past 5 years', range: 1825, bucket: 'year', count: 5 },
];

const METRICS = {
  follows: { key: 'page_daily_follows_unique', label: 'Follows', color: '#2fb457' },
  unfollows: { key: 'page_daily_unfollows_unique', label: 'Unfollows', color: '#e63b2e' },
  views: { key: 'post_views', label: 'Views', color: '#1f9be6' },
  visits: { key: 'page_views_total', label: 'Visits', color: '#f5a623' },
  engagement: { key: 'page_post_engagements', label: 'Engagement', color: '#7c3aed' },
};

const CHARTS = [
  {
    key: 'audience',
    title: 'Follows vs unfollows',
    hint: 'Audience movement by period',
    metrics: ['follows', 'unfollows'],
    showLegend: true,
  },
  { key: 'views', title: 'Views', hint: 'Views on published content', metrics: ['views'] },
  { key: 'visits', title: 'Visits', hint: 'Times your Page profile was visited', metrics: ['visits'] },
  { key: 'engagement', title: 'Engagement', hint: 'Reactions, comments, shares and clicks', metrics: ['engagement'] },
];

// The combined "compare everything" chart: all metrics grouped under one shared
// y-axis so growth reads side-by-side (legend toggles series to focus a subset).
const COMBINED_METRICS = ['follows', 'unfollows', 'views', 'visits', 'engagement'];

// Trailing "go to content" affordance on each ranked-post row.
function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

const fmtNum = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
};
// Exact, thousands-separated — the headline KPI cards show the precise figure
// (e.g. 3,742) rather than the abbreviated 3.7k.
const fmtExact = (n) => (Number(n) || 0).toLocaleString('en-US');
const sumValues = (arr) => (arr || []).reduce((a, v) => a + (Number(v) || 0), 0);

const DAY_MS = 86400 * 1000;
const toIsoDay = (date) => date.toISOString().slice(0, 10);
const monthKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const startOfTodayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const startOfWeek = (date) => addDays(date, -((date.getUTCDay() + 6) % 7));
const shortDate = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortMonth = (date) => date.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });

function makeBuckets(period) {
  const today = startOfTodayUtc();
  if (period.bucket === 'day') {
    return Array.from({ length: period.count }, (_, i) => {
      const date = addDays(today, i - period.count + 1);
      return { key: toIsoDay(date), label: shortDate(date) };
    });
  }
  if (period.bucket === 'week') {
    const thisWeek = startOfWeek(today);
    return Array.from({ length: period.count }, (_, i) => {
      const start = addDays(thisWeek, (i - period.count + 1) * 7);
      return { key: toIsoDay(start), label: shortDate(start) };
    });
  }
  if (period.bucket === 'month') {
    return Array.from({ length: period.count }, (_, i) => {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i - period.count + 1, 1));
      return { key: monthKey(date), label: shortMonth(date) };
    });
  }
  return Array.from({ length: period.count }, (_, i) => {
    const year = today.getUTCFullYear() + i - period.count + 1;
    return { key: String(year), label: String(year) };
  });
}

function parsePeriod(period) {
  const value = String(period || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(value)) return new Date(`${value}-01T00:00:00Z`);
  if (/^\d{4}$/.test(value)) return new Date(`${value}-01-01T00:00:00Z`);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bucketKey(date, bucket) {
  if (bucket === 'day') return toIsoDay(date);
  if (bucket === 'week') return toIsoDay(startOfWeek(date));
  if (bucket === 'month') return monthKey(date);
  return String(date.getUTCFullYear());
}

function aggregate(points, buckets, bucket) {
  const values = new Map(buckets.map((b) => [b.key, 0]));
  for (const point of points || []) {
    const date = parsePeriod(point.period);
    if (!date) continue;
    const key = bucketKey(date, bucket);
    if (values.has(key)) values.set(key, values.get(key) + (Number(point.value) || 0));
  }
  return buckets.map((b) => values.get(b.key) || 0);
}

// Ranked posts come from post_pool (media_type is only 'image'/'video'), so they live
// under Contents → Posts & reels; a story would route to the Stories view instead.
const contentsHref = (p) => (p.media_type === 'story' ? '/post-pool?view=stories' : '/post-pool?view=posts');
const contentsLabel = (p) => (p.media_type === 'story' ? 'Stories' : 'Posts & reels');

export default function AnalyticsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [periodKey, setPeriodKey] = useState('days');
  const [downloading, setDownloading] = useState(false);
  const period = PERIODS.find((p) => p.key === periodKey) || PERIODS[0];
  const range = period.range;

  const { data, loading, error } = useCachedResource(`analytics:overview:${range}`, () => analytics.overview(range));

  // Build a professional PDF of the current range (summary cards, metric charts, top posts).
  const downloadReport = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      // Lazy-load the PDF builder (jsPDF) so it stays out of the main bundle, matching
      // how the post InsightsDrawer imports it.
      const { buildPageAnalyticsPdf, loadLogo } = await import('../../utils/reportPdf.js');
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - (range - 1));
      const logo = await loadLogo();
      const doc = buildPageAnalyticsPdf({
        start,
        end,
        pageName: data.pageName,
        logo,
        followers: data.followers,
        series: data.series || {},
        ranking: data.ranking || [],
      });
      doc.save(`analytics-${range}d.pdf`);
    } catch {
      toast.error('Could not generate the report.');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  const series = data?.series || {};
  const buckets = useMemo(() => makeBuckets(period), [period]);
  const bucketed = useMemo(() => {
    const next = {};
    for (const [id, metric] of Object.entries(METRICS)) {
      next[id] = aggregate(series[metric.key], buckets, period.bucket);
    }
    return next;
  }, [series, buckets, period.bucket]);
  const hasData = Object.values(METRICS).some((metric) => (series[metric.key] || []).length > 0);

  if (loading && !data) return <Spinner label="Loading analytics…" />;

  const engagement = sumValues(bucketed.engagement);
  const newFollows = sumValues(bucketed.follows);
  const unfollows = sumValues(bucketed.unfollows);
  const views = sumValues(bucketed.views);
  const visits = sumValues(bucketed.visits);
  const hasViews = (series.post_views || []).length > 0;
  const hasVisits = (series.page_views_total || []).length > 0;
  // All metrics that actually have data, as a single grouped series set for the
  // combined comparison chart (empty metrics are dropped so the legend stays clean).
  const combinedSeries = COMBINED_METRICS
    .filter((id) => (series[METRICS[id].key] || []).length > 0)
    .map((id) => ({ key: id, label: METRICS[id].label, color: METRICS[id].color, values: bucketed[id] || [] }));
  const growthStats = [
    { label: 'Followers', value: data?.followers != null ? fmtExact(data.followers) : '-', color: 'var(--primary)' },
    { label: `Follows - ${period.hint}`, value: fmtExact(newFollows), color: 'var(--success)' },
    { label: `Unfollows - ${period.hint}`, value: fmtExact(unfollows), color: 'var(--danger)' },
    { label: `Net follows - ${period.hint}`, value: fmtExact(newFollows - unfollows), color: 'var(--primary)' },
    { label: `Views - ${period.hint}`, value: hasViews ? fmtExact(views) : '-', color: 'var(--blue)' },
    { label: `Visits - ${period.hint}`, value: hasVisits ? fmtExact(visits) : '-', color: 'var(--warning)' },
    { label: `Engagement - ${period.hint}`, value: fmtExact(engagement), color: 'var(--accent)' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Analytics</h1>
          <div className="page-head__sub">{data?.pageName || 'Your page performance over time.'}</div>
        </div>
        <div className="analytics-actions">
          <div className="seg">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`seg__btn ${periodKey === p.key ? 'is-active' : ''}`}
                onClick={() => setPeriodKey(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--subtle btn--sm" onClick={downloadReport} disabled={downloading || !hasData}>
            {downloading ? 'Preparing…' : 'Download report'}
          </button>
        </div>
      </div>

      <div className="grid grid--stats grid--stats--3">
        {growthStats.map((s) => (
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
            message="Once the snapshot job runs (or on first load) your follows, views, visits and engagement bars will appear here."
          />
        </Card>
      ) : (
        <>
          <Card className="card--pad mt-lg">
            <div className="analytics-chart__head">
              <div>
                <div className="analytics-chart__title">Growth comparison</div>
                <div className="text-sm text-muted">
                  Every metric side by side - {period.hint}. Tap a metric in the legend to focus it.
                </div>
              </div>
            </div>
            <div className="analytics-chart__body analytics-chart__body--bars">
              <BarChart
                buckets={buckets}
                series={combinedSeries}
                showLegend
                ariaLabel={`All metrics by ${period.label.toLowerCase()}`}
              />
            </div>
          </Card>

          <div className="analytics-charts analytics-charts--growth mt-lg">
          {CHARTS.map((chart) => {
            const chartSeries = chart.metrics.map((metricId) => {
              const metric = METRICS[metricId];
              return {
                key: metricId,
                label: metric.label,
                color: metric.color,
                values: bucketed[metricId] || [],
              };
            });
            const chartHasData = chart.metrics.some((metricId) => (series[METRICS[metricId].key] || []).length > 0);
            return (
              <Card key={chart.key} className="card--pad analytics-growth-card">
                <div className="analytics-chart__head">
                  <div>
                    <div className="analytics-chart__title">{chart.title}</div>
                    <div className="text-sm text-muted">{chart.hint} - {period.hint}</div>
                  </div>
                </div>
                <div className="analytics-chart__body analytics-chart__body--bars">
                  {chartHasData ? (
                    <BarChart
                      buckets={buckets}
                      series={chartSeries}
                      showLegend={chart.showLegend ?? chartSeries.length > 1}
                      ariaLabel={`${chart.title} by ${period.label.toLowerCase()}`}
                    />
                  ) : (
                    <div className="text-sm text-muted analytics-chart__empty">
                      No data for this metric in this range.
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
          </div>
        </>
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
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {data.ranking.map((p) => {
                  const openInsights = () => navigate(`/post/${p.id}/insights`);
                  return (
                    <tr
                      key={p.id}
                      className="ranking-row"
                      role="button"
                      tabIndex={0}
                      title="Open this post's insights"
                      onClick={openInsights}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openInsights();
                        }
                      }}
                    >
                      <td className="cell-truncate" data-label="Post">
                        #{p.id}
                        {p.caption ? ` — ${p.caption.slice(0, 60)}` : ''}
                      </td>
                      <td data-label="Reactions">{fmtNum(p.reactions_count)}</td>
                      <td data-label="Comments">{fmtNum(p.comments_count)}</td>
                      <td data-label="Shares">{fmtNum(p.shares_count)}</td>
                      <td data-label="Engagement">
                        <strong>{fmtNum(p.engagement)}</strong>
                      </td>
                      {/* Stop the row-click so the arrow jumps to Contents, not this post's insights. */}
                      <td className="ranking-row__go" data-label={contentsLabel(p)} onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={contentsHref(p)}
                          className="card-iconbtn"
                          title={`Open in ${contentsLabel(p)}`}
                          aria-label={`Open in ${contentsLabel(p)}`}
                        >
                          <ArrowIcon />
                        </Link>
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
