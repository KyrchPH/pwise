import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import * as analytics from '../../services/analytics.service.js';
import * as stories from '../../services/stories.service.js';
import * as surveys from '../../services/surveys.service.js';
import * as planner from '../../services/planner.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner, Button, StatusBadge, EmptyState, MediaThumb, HeartIcon, CommentIcon, ShareIcon } from '../../components/ui.jsx';
import LineChart from '../../components/LineChart.jsx';

const CHART_COLOR = '#1f9be6';
const RANGES = [
  { days: 7, label: '7 days' },
  { days: 28, label: '28 days' },
  { days: 90, label: '90 days' },
];
const CONTENT_TABS = [
  { key: 'all', label: 'All' },
  { key: 'posts', label: 'Posts' },
  { key: 'reels', label: 'Reels' },
];
const STRIP_LIMIT = 8; // media items shown per horizontal strip
const METRIC_NOUN = {
  followers: 'followers',
  posts: 'posts',
  comments: 'comments',
  shares: 'shares',
  views: 'views',
  reactions: 'reactions',
};
const PERIOD_LABEL = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
};
const fmtExact = (n) => (Number(n) || 0).toLocaleString('en-US');
const fmtLong = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const fmtSigned = (n) => (n == null ? 'n/a' : `${Number(n) > 0 ? '+' : ''}${Number(n)}`);
const pctOf = (value, total) => (total > 0 ? Math.round((Number(value || 0) / total) * 100) : 0);
const goalStatusLabel = (status) => (status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : 'Unknown');
const goalStatusBadge = (status) => (status === 'completed' ? 'ready' : status === 'expired' ? 'archived' : 'posting');
const npsScoreTone = (score) => {
  if (score == null) return 'empty';
  if (score >= 50) return 'high';
  if (score >= 0) return 'mid';
  return 'low';
};

// Relative "time ago" for when content went out — mirrors the posts grid voice.
function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const postedTime = (p) => new Date(p.posted_at || p.created_at || 0).getTime();
const isReel = (p) => p.media_type === 'video';

function Delta({ pct }) {
  if (pct == null) return null;
  const cls = pct > 0 ? 'perf-delta--up' : pct < 0 ? 'perf-delta--down' : 'perf-delta--flat';
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '';
  return (
    <span className={`perf-delta ${cls}`}>
      {arrow} {Math.abs(pct)}%
    </span>
  );
}

function RangeSeg({ range, onChange }) {
  return (
    <div className="seg" role="tablist" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r.days}
          type="button"
          className={`seg__btn ${range === r.days ? 'is-active' : ''}`}
          onClick={() => onChange(r.days)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

// A clickable headline metric that drives the trend chart below.
function MetricTile({ tile, active, onSelect }) {
  return (
    <button type="button" className={`msg-tile ${active ? 'is-active' : ''}`} onClick={() => onSelect(tile.key)} aria-pressed={active}>
      <span className="msg-tile__title">{tile.title}</span>
      <span className="msg-tile__value-row">
        <span className="msg-tile__value">{tile.available ? fmtCompact(tile.total) : 'n/a'}</span>
        <Delta pct={tile.changePct} />
      </span>
    </button>
  );
}

// One media teaser in a horizontal content strip (post, reel or story).
function MediaTeaser({ to, mediaUrl, mediaType, thumbnailUrl, tag, tagClass, caption, meta, foot }) {
  return (
    <Link to={to} className="dash-media">
      <div className="dash-media__thumb">
        <MediaThumb mediaUrl={mediaUrl} mediaType={mediaType} thumbnailUrl={thumbnailUrl}>
          {tag && <span className={`dash-media__tag ${tagClass || ''}`}>{tag}</span>}
        </MediaThumb>
      </div>
      <div className="dash-media__body">
        {caption && <div className="dash-media__caption">{caption}</div>}
        {meta && <div className="dash-media__meta">{meta}</div>}
        {foot && <div className="dash-media__foot">{foot}</div>}
      </div>
    </Link>
  );
}

function StripHeader({ title, sub, tabs, activeTab, onTab, viewAllTo }) {
  return (
    <div className="dash-strip__head">
      <div className="dash-strip__titlewrap">
        <h2 className="dash-strip__title">{title}</h2>
        {sub && <span className="dash-strip__sub">{sub}</span>}
      </div>
      <div className="dash-strip__head-end">
        {tabs && (
          <div className="seg" role="tablist" aria-label={`${title} filter`}>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`seg__btn ${activeTab === t.key ? 'is-active' : ''}`}
                onClick={() => onTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <Link to={viewAllTo} className="dash-viewall">
          View all <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const toast = useToast();
  const { activeId, activePage } = usePages();
  const [range, setRange] = useState(28);
  const [metricKey, setMetricKey] = useState(null); // selected trend metric (null → first available)
  const [contentTab, setContentTab] = useState('all');

  const cacheKey = activeId ? `dashboard:${activeId}:${range}` : null;
  const { data, loading, error } = useCachedResource(cacheKey, () =>
    Promise.all([
      postPool.counts(),
      analytics.highlights(range).catch(() => null), // insights are best-effort; the rest of the page still renders
      postPool.list({ status: 'posted', limit: 24 }),
      stories.list({ limit: 12 }),
      surveys.summary(range, activeId).catch(() => null),
      planner.listPlans().catch(() => null),
    ]).then(([counts, highlights, posted, storyList, npsSummary, plannerData]) => ({
      counts,
      highlights,
      posts: posted?.posts || [],
      stories: storyList?.stories || [],
      npsSummary,
      // Goals now live under plans; flatten to the visible goals across all plans.
      goals: (plannerData?.plans || []).flatMap((p) => p.goals || []),
    })),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  const posts = data?.posts || [];
  // Newest-first, defensively (server ordering isn't guaranteed for this digest view).
  const recentPosts = useMemo(() => [...posts].sort((a, b) => postedTime(b) - postedTime(a)), [posts]);
  const recentStories = useMemo(
    () => [...(data?.stories || [])].sort((a, b) => postedTime(b) - postedTime(a)),
    [data],
  );
  const contentItems = useMemo(() => {
    const filtered =
      contentTab === 'posts' ? recentPosts.filter((p) => !isReel(p))
      : contentTab === 'reels' ? recentPosts.filter(isReel)
      : recentPosts;
    return filtered.slice(0, STRIP_LIMIT);
  }, [recentPosts, contentTab]);
  const closestGoals = useMemo(() => {
    const pageKey = activeId == null ? null : String(activeId);
    if (!pageKey) return [];
    return [...(data?.goals || [])]
      .filter((g) => String(g.account_id) === pageKey)
      .sort((a, b) => {
        const byProgress = Number(b.percent || 0) - Number(a.percent || 0);
        if (byProgress !== 0) return byProgress;
        return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
      })
      .slice(0, 3);
  }, [data, activeId]);

  if (!activeId) {
    return <EmptyState icon="📊" title="No page selected" message="Choose a connected page to see its dashboard." />;
  }
  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  if (!data) return null;

  const { counts, highlights, npsSummary } = data;
  const tiles = highlights?.tiles || [];
  const activeTile =
    tiles.find((t) => t.key === metricKey)
    || tiles.find((t) => t.available && (t.series || []).length >= 2)
    || tiles[0];
  const series = activeTile?.series || [];
  const followers = highlights?.followers;
  const rangeText = highlights?.sinceDate ? `${fmtLong(highlights.sinceDate)} – ${fmtLong(highlights.untilDate)}` : '';
  const nps = npsSummary?.nps || {};
  const csat = npsSummary?.csat || {};
  const npsScore = nps.score ?? null;
  const npsSample = Number(nps.sample) || 0;
  const npsTone = npsScoreTone(npsScore);
  const detractorPct = pctOf(nps.detractors, npsSample);
  const passivePct = pctOf(nps.passives, npsSample);
  const promoterPct = pctOf(nps.promoters, npsSample);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Dashboard</h1>
          <div className="page-head__sub">
            {activePage?.account_name ? `${activePage.account_name} · ` : ''}
            Performance, content, NPS and goals at a glance.
          </div>
        </div>
        <div className="dash-head-actions">
          <RangeSeg range={range} onChange={setRange} />
        </div>
      </div>

      {/* ── Performance overview: metric summary + trend (insights / analytics) ── */}
      <Card className="msg-insights dash-perf">
        <div className="msg-insights__head ov-head">
          <div>
            <h2 className="msg-insights__title">Performance overview</h2>
            <p className="msg-insights__sub">{rangeText || 'How your Page is doing over the selected period.'}</p>
          </div>
          {followers != null && (
            <div className="ov-followers">
              <span className="ov-followers__num">{fmtExact(followers)}</span>
              <span className="ov-followers__label">followers</span>
            </div>
          )}
        </div>

        {tiles.length ? (
          <>
            <div className="msg-tiles">
              {tiles.map((t) => (
                <MetricTile key={t.key} tile={t} active={activeTile?.key === t.key} onSelect={setMetricKey} />
              ))}
            </div>
            <div className="msg-chart">
              {series.length >= 2 ? (
                <LineChart points={series} color={CHART_COLOR} label={activeTile?.title} wide />
              ) : (
                <div className="msg-chart__empty">
                  {activeTile?.available === false ? 'No available data for this metric.' : 'No daily trend for this period yet.'}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="dash-perf__empty">
            Insights aren&rsquo;t available for this page yet. <Link to="/insights" className="link">Open Insights</Link> once your Page has activity.
          </div>
        )}

        <div className="dash-perf__foot">
          <Button as={Link} to="/insights" variant="subtle" size="sm">Insights overview</Button>
          <Button as={Link} to="/insights?view=performance" variant="ghost" size="sm">Performance</Button>
          <Button as={Link} to="/insights?view=contents" variant="ghost" size="sm">Content report</Button>
        </div>
      </Card>

      {/* ── Recent posts & reels ── */}
      <Card className="card--pad dash-strip mt-lg">
        <StripHeader
          title="Recent posts & reels"
          sub="Latest published content"
          tabs={CONTENT_TABS}
          activeTab={contentTab}
          onTab={setContentTab}
          viewAllTo="/post-pool?view=posts"
        />
        {contentItems.length ? (
          <div className="dash-strip__rail">
            {contentItems.map((p) => (
              <MediaTeaser
                key={p.id}
                to="/post-pool?view=posts"
                mediaUrl={p.media_preview_url}
                mediaType={p.media_type}
                thumbnailUrl={p.thumbnail_preview_url}
                tag={isReel(p) ? 'Reel' : null}
                tagClass="dash-media__tag--reel"
                caption={p.caption ? p.caption.slice(0, 70) : <span className="text-muted">No caption</span>}
                meta={
                  p.engagement_synced_at ? (
                    <>
                      <span className="dash-media__stat" title="Reactions"><HeartIcon size={14} /> {fmtCompact(p.reactions_count)}</span>
                      <span className="dash-media__stat" title="Comments"><CommentIcon size={14} /> {fmtCompact(p.comments_count)}</span>
                      <span className="dash-media__stat" title="Shares"><ShareIcon size={14} /> {fmtCompact(p.shares_count)}</span>
                    </>
                  ) : (
                    <span className="text-muted">Syncing…</span>
                  )
                }
                foot={timeAgo(p.posted_at)}
              />
            ))}
          </div>
        ) : (
          <div className="dash-strip__empty">
            {contentTab === 'reels'
              ? 'No reels published recently.'
              : contentTab === 'posts'
                ? 'No photo posts published recently.'
                : 'Nothing published yet — upload your first post.'}
          </div>
        )}
      </Card>

      {/* ── Recent stories ── */}
      <Card className="card--pad dash-strip mt-lg">
        <StripHeader title="Recent stories" sub="24-hour Facebook & Instagram stories" viewAllTo="/post-pool?view=stories" />
        {recentStories.length ? (
          <div className="dash-strip__rail">
            {recentStories.slice(0, STRIP_LIMIT).map((s) => (
              <MediaTeaser
                key={s.id}
                to="/post-pool?view=stories"
                mediaUrl={s.media_preview_url}
                mediaType={s.media_type}
                thumbnailUrl={s.thumbnail_preview_url}
                tag={s.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                tagClass={`dash-media__tag--${s.platform}`}
                meta={<StatusBadge status={s.status} />}
                foot={timeAgo(s.posted_at || s.created_at)}
              />
            ))}
          </div>
        ) : (
          <div className="dash-strip__empty">No stories posted yet.</div>
        )}
      </Card>

      {/* Customer health, closest goals and content pipeline */}
      <div className="grid-2 mt-lg">
        <Card className="dash-nps-card">
          <div className="card__head">
            <div>
              <div className="card__title">NPS Survey</div>
              <div className="dash-card__sub">Last {range} days</div>
            </div>
            <span className={`badge badge--${npsSample ? 'ready' : 'draft'}`}>
              {npsSample} response{npsSample === 1 ? '' : 's'}
            </span>
          </div>
          <div className="card--pad dash-nps">
            <div className="dash-nps__hero">
              <div>
                <div className="dash-nps__label">NPS score</div>
                <div className={`dash-nps__score dash-nps__score--${npsTone}`}>{fmtSigned(npsScore)}</div>
              </div>
              <div className="dash-nps__csat">
                <span>CSAT</span>
                <strong>{csat.avg == null ? 'n/a' : `${csat.avg}/5`}</strong>
              </div>
            </div>

            <div className="dash-nps__bar" aria-label="NPS response mix">
              <span
                className="dash-nps__bar-seg dash-nps__bar-seg--detractor"
                style={{ width: `${detractorPct}%` }}
                title={`Detractors: ${nps.detractors || 0}`}
              />
              <span
                className="dash-nps__bar-seg dash-nps__bar-seg--passive"
                style={{ width: `${passivePct}%` }}
                title={`Passives: ${nps.passives || 0}`}
              />
              <span
                className="dash-nps__bar-seg dash-nps__bar-seg--promoter"
                style={{ width: `${promoterPct}%` }}
                title={`Promoters: ${nps.promoters || 0}`}
              />
            </div>

            <div className="dash-metric-grid">
              <div className="dash-metric">
                <span>Sent</span>
                <strong>{fmtExact(npsSummary?.sent)}</strong>
              </div>
              <div className="dash-metric">
                <span>Responded</span>
                <strong>{fmtExact(npsSummary?.responded)}</strong>
              </div>
              <div className="dash-metric">
                <span>Response rate</span>
                <strong>{npsSummary?.responseRatePct == null ? 'n/a' : `${npsSummary.responseRatePct}%`}</strong>
              </div>
            </div>

            <div className="dash-nps__legend">
              <span><i className="dash-nps__dot dash-nps__dot--detractor" /> Detractors {nps.detractors || 0}</span>
              <span><i className="dash-nps__dot dash-nps__dot--passive" /> Passives {nps.passives || 0}</span>
              <span><i className="dash-nps__dot dash-nps__dot--promoter" /> Promoters {nps.promoters || 0}</span>
            </div>
            <Button as={Link} to="/messages" variant="subtle" size="sm">Open messaging</Button>
          </div>
        </Card>

        <Card className="dash-goals-card">
          <div className="card__head">
            <div>
              <div className="card__title">Closest goals</div>
              <div className="dash-card__sub">Top 3 by progress</div>
            </div>
            <span className="badge badge--ready">{closestGoals.length}/3</span>
          </div>
          <div className="card--pad dash-goals">
            {closestGoals.length ? (
              closestGoals.map((goal, index) => {
                const noun = METRIC_NOUN[goal.metric] || goal.metric;
                const percent = Math.max(0, Math.min(100, Number(goal.percent) || 0));
                const meta = [PERIOD_LABEL[goal.period] || goal.period, noun].filter(Boolean).join(' goal - ');
                return (
                  <Link key={goal.id} to="/planner" className={`dash-goal dash-goal--${goal.status || 'unknown'}`}>
                    <span className="dash-goal__rank">{index + 1}</span>
                    <span className="dash-goal__main">
                      <span className="dash-goal__top">
                        <span className="dash-goal__title">{goal.title}</span>
                        <span className={`badge badge--${goalStatusBadge(goal.status)}`}>{goalStatusLabel(goal.status)}</span>
                      </span>
                      <span className="dash-goal__meta">{meta}</span>
                      <span className="dash-goal__progress">
                        <span className="dash-goal__bar" aria-hidden="true">
                          <span className="dash-goal__fill" style={{ width: `${percent}%` }} />
                        </span>
                        <strong>{percent}%</strong>
                      </span>
                    </span>
                    <span className="dash-goal__count">
                      {fmtCompact(goal.current_value)} / {fmtCompact(goal.target_value)}
                    </span>
                  </Link>
                );
              })
            ) : (
              <div className="dash-strip__empty">No goals for this page yet.</div>
            )}
            <Button as={Link} to="/planner" variant="subtle" size="sm">Open planner</Button>
          </div>
        </Card>

        <Card>
          <div className="card__head">
            <div className="card__title">Content pipeline</div>
          </div>
          <div className="card--pad col gap-sm">
            <div className="dash-pipeline">
              {[
                { key: 'posted', label: 'Posted', color: 'var(--accent)' },
                { key: 'ready', label: 'Ready', color: 'var(--success)' },
                { key: 'posting', label: 'Posting', color: 'var(--primary)' },
                { key: 'failed', label: 'Failed', color: 'var(--danger)' },
                { key: 'draft', label: 'Drafts', color: 'var(--muted)' },
                { key: 'archived', label: 'Archived', color: 'var(--faint)' },
              ].map((s) => (
                <div className="dash-pipeline__item" key={s.key}>
                  <span className="dash-pipeline__dot" style={{ background: s.color }} />
                  <span className="dash-pipeline__value">{counts[s.key] ?? 0}</span>
                  <span className="dash-pipeline__label">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="row gap-sm mt-lg row--wrap">
              <Button as={Link} to="/post-pool" variant="subtle" size="sm">Manage content</Button>
              <Button as={Link} to="/logs" variant="ghost" size="sm">View logs</Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
