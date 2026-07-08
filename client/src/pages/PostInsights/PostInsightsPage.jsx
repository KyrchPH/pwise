import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import * as analytics from '../../services/analytics.service.js';
import { apiError } from '../../services/api.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Button } from '../../components/ui.jsx';
import BarChart from '../../components/BarChart.jsx';

// Standalone, full-tab metrics view for one post (opened by the post viewer's
// Insights button in a new tab). A grouped bar chart shows engagement history per
// day / week / month; the right sidebar breaks down a chosen DATE RANGE (set by
// clicking a bar or with the From/To pickers).

// Per-post engagement metrics (cumulative snapshots → diffed into per-day gains).
const ENGAGEMENT = [
  { key: 'reactions', label: 'Reactions', color: '#f78fb3', countKey: 'reactions_count' },
  { key: 'comments', label: 'Comments', color: '#6cc1f4', countKey: 'comments_count' },
  { key: 'shares', label: 'Shares', color: '#6ad995', countKey: 'shares_count' },
  { key: 'views', label: 'Views', color: '#b79cf5', countKey: 'views_count' },
];

// Page-level audience metrics (already daily counts) over the post's active window.
// Facebook exposes follows only at the page level — no per-post follows/unfollows.
const AUDIENCE = [
  { key: 'followers', label: 'Followers', color: '#5cd6c0', audience: true },
  { key: 'pageVisits', label: 'Page visits', color: '#f2d06b', audience: true },
];

const GRANS = [
  { value: 'day', label: 'Day', window: 12, noun: 'day' },
  { value: 'week', label: 'Week', window: 10, noun: 'week' },
  { value: 'month', label: 'Month', window: 12, noun: 'month' },
];

const pad = (n) => String(n).padStart(2, '0');
const fmtNum = (v) => Number(v || 0).toLocaleString();
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function fmtWatch(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return sec ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}
function fmtClock(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Cumulative daily points → per-day gains ([{ date, delta }]).
function dailyDeltas(points) {
  const out = [];
  let prev = 0;
  for (let i = 0; i < points.length; i += 1) {
    const v = Number(points[i].value) || 0;
    out.push({ date: points[i].period, delta: Math.max(0, i === 0 ? v : v - prev) });
    prev = v;
  }
  return out;
}

function bucketKey(dateStr, gran) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (gran === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (gran === 'week') {
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    const mon = new Date(d);
    mon.setDate(d.getDate() - dow);
    return ymd(mon);
  }
  return dateStr;
}

function bucketLabel(key, gran) {
  if (gran === 'month') return new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The day span (from/to as 'YYYY-MM-DD') a bucket covers, for the given granularity.
function bucketSpan(key, gran) {
  if (gran === 'day') return { from: key, to: key };
  if (gran === 'week') {
    const start = new Date(`${key}T00:00:00`);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: key, to: ymd(end) };
  }
  const [y, mo] = key.split('-').map(Number); // month key = 'YYYY-MM'
  return { from: `${key}-01`, to: ymd(new Date(y, mo, 0)) };
}

const fmtDay = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function rangeLabel(from, to) {
  if (!from) return '—';
  return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
}

function sumInRange(daily, from, to) {
  let s = 0;
  for (const { date, delta } of daily || []) if (date >= from && date <= to) s += delta;
  return s;
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Page daily follows / page-visits for the post's active window (posted_at → now).
async function fetchAudience(p) {
  try {
    const posted = p.posted_at ? new Date(p.posted_at) : null;
    const days = posted
      ? Math.min(365, Math.max(7, Math.ceil((Date.now() - posted.getTime()) / 86_400_000) + 1))
      : 28;
    const ov = await analytics.overview(days, p.account_id);
    const cut = posted ? ymd(posted) : null;
    const pick = (k) =>
      (ov?.series?.[k] || [])
        .filter((pt) => !cut || pt.period >= cut)
        .map((pt) => ({ date: pt.period, delta: Math.max(0, Number(pt.value) || 0) }));
    return { followers: pick('page_daily_follows_unique'), pageVisits: pick('page_views_total') };
  } catch {
    return { followers: [], pageVisits: [] };
  }
}

export default function PostInsightsPage() {
  const { id } = useParams();
  const { pages, activePage } = usePages();
  const toast = useToast();
  const [post, setPost] = useState(null);
  const [series, setSeries] = useState({});
  const [audience, setAudience] = useState({ followers: [], pageVisits: [] });
  const [gran, setGran] = useState('day');
  const [range, setRange] = useState(null); // { from, to } | null → latest bucket
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const p = await postPool.get(id);
        if (!alive) return;
        setPost(p);
        const isVideo = p.media_type === 'video';
        const keys = ENGAGEMENT.filter((m) => m.key !== 'views' || isVideo).map((m) => m.key);
        const [engEntries, aud] = await Promise.all([
          Promise.all(keys.map((k) => postPool.insights(id, k, 'day').then((r) => [k, r.points || []]).catch(() => [k, []]))),
          fetchAudience(p),
        ]);
        if (!alive) return;
        setSeries(Object.fromEntries(engEntries));
        setAudience(aud);
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    document.title = post ? `Insights · Post #${post.id}` : 'Post insights';
  }, [post]);

  const pageName = useMemo(() => {
    if (!post) return activePage?.account_name || 'Your Page';
    return pages.find((p) => p.id === post.account_id)?.account_name || activePage?.account_name || 'Your Page';
  }, [post, pages, activePage]);

  const isVideo = post?.media_type === 'video';
  const metrics = useMemo(
    () => [...ENGAGEMENT.filter((m) => m.key !== 'views' || isVideo), ...AUDIENCE],
    [isVideo],
  );
  const granCfg = GRANS.find((g) => g.value === gran) || GRANS[0];

  // Per-day gains per metric (for range sums) + the same rolled up to chart buckets.
  const { buckets, chartSeries, dailyByMetric, minDate, maxDate } = useMemo(() => {
    const daily = {};
    for (const m of metrics) {
      if (m.key === 'followers') daily[m.key] = audience.followers;
      else if (m.key === 'pageVisits') daily[m.key] = audience.pageVisits;
      else daily[m.key] = dailyDeltas(series[m.key] || []);
    }
    const perBucket = {};
    const allKeys = new Set();
    let mn = null;
    let mx = null;
    for (const m of metrics) {
      const map = {};
      for (const { date, delta } of daily[m.key]) {
        const bk = bucketKey(date, gran);
        allKeys.add(bk);
        map[bk] = (map[bk] || 0) + delta;
        if (mn === null || date < mn) mn = date;
        if (mx === null || date > mx) mx = date;
      }
      perBucket[m.key] = map;
    }
    const keys = [...allKeys].sort().slice(-granCfg.window);
    return {
      buckets: keys.map((k) => ({ key: k, label: bucketLabel(k, gran) })),
      chartSeries: metrics.map((m) => ({
        key: m.key,
        label: m.label,
        color: m.color,
        values: keys.map((k) => perBucket[m.key][k] || 0),
      })),
      dailyByMetric: daily,
      minDate: mn,
      maxDate: mx,
    };
  }, [series, audience, metrics, gran, granCfg.window]);

  const hasHistory = buckets.length > 0;
  // Effective range: an explicit pick, else the latest bucket's span.
  const effRange = range || (hasHistory ? bucketSpan(buckets[buckets.length - 1].key, gran) : null);

  // Which chart buckets the range covers (highlighted behind the bars).
  const selectedKeys = useMemo(() => {
    const set = new Set();
    if (!effRange) return set;
    for (const b of buckets) {
      const sp = bucketSpan(b.key, gran);
      if (sp.from <= effRange.to && sp.to >= effRange.from) set.add(b.key);
    }
    return set;
  }, [buckets, gran, effRange]);

  if (loading) {
    return (
      <div className="pinsights">
        <div className="pinsights__loading"><Spinner label="Loading insights…" /></div>
      </div>
    );
  }
  if (error || !post) {
    return (
      <div className="pinsights">
        <div className="pinsights__loading">
          <div className="pinsights__error">
            <div className="pinsights__error-title">Couldn’t load this post’s insights</div>
            <div className="pinsights__error-sub">{error ? apiError(error) : 'The post could not be found.'}</div>
          </div>
        </div>
      </div>
    );
  }

  const thumb = post.thumbnail_preview_url || post.media_preview_url || null;

  // Sidebar rows: each metric summed over the selected range (+ its running total).
  const rows = metrics.map((m) => {
    const value = effRange ? sumInRange(dailyByMetric[m.key], effRange.from, effRange.to) : 0;
    const windowSum = (dailyByMetric[m.key] || []).reduce((a, d) => a + d.delta, 0);
    const total = m.countKey && post[m.countKey] != null ? Number(post[m.countKey]) : windowSum;
    return { ...m, value, total };
  });

  const selectBucket = (i) => {
    const b = buckets[i];
    if (b) setRange(bucketSpan(b.key, gran));
  };
  const setFrom = (v) => {
    if (!v) return;
    const to = effRange && v > effRange.to ? v : effRange?.to || v;
    setRange({ from: v, to });
  };
  const setTo = (v) => {
    if (!v) return;
    const from = effRange && v < effRange.from ? v : effRange?.from || v;
    setRange({ from, to: v });
  };

  // Build a branded PDF for the currently-selected range (summary + day-by-day).
  const downloadReport = async () => {
    if (downloading || !effRange) return;
    setDownloading(true);
    try {
      const { from, to } = effRange;
      const dateSet = new Set();
      for (const m of metrics) for (const { date } of dailyByMetric[m.key] || []) if (date >= from && date <= to) dateSet.add(date);
      const dates = [...dateSet].sort();

      const cards = metrics
        .filter((m) => !m.audience)
        .map((m) => ({ label: m.label, value: fmtNum(rows.find((r) => r.key === m.key)?.value || 0), color: hexToRgb(m.color) }));
      const summaryBody = rows.map((r) => [r.label, fmtNum(r.value), fmtNum(r.total)]);
      const dailyHead = ['Date', ...metrics.map((m) => m.label)];
      const dailyBody = dates.map((d) => [
        fmtDay(d),
        ...metrics.map((m) => {
          const hit = (dailyByMetric[m.key] || []).find((x) => x.date === d);
          return fmtNum(hit ? hit.delta : 0);
        }),
      ]);
      const videoBody = [];
      if (isVideo && post.video_watch_time_s != null) videoBody.push(['Watch time', fmtWatch(post.video_watch_time_s)]);
      if (isVideo && post.video_avg_watch_s != null) videoBody.push(['Avg play time', fmtClock(post.video_avg_watch_s)]);

      const { buildPostRangeReportPdf, loadLogo, loadImageData } = await import('../../utils/reportPdf.js');
      const [logo, thumbnail] = await Promise.all([
        loadLogo(),
        loadImageData(post.thumbnail_preview_url || post.media_preview_url),
      ]);
      const doc = buildPostRangeReportPdf({
        post,
        pageName,
        logo,
        thumbnail,
        from: new Date(`${from}T00:00:00`),
        to: new Date(`${to}T00:00:00`),
        cards,
        summaryTable: { head: ['Metric', 'In range', 'Total'], body: summaryBody },
        dailyTable: { head: dailyHead, body: dailyBody },
        videoTable: videoBody.length ? { head: ['Video metric', 'Value'], body: videoBody } : null,
      });
      doc.save(`post-${post.id}-insights-${from}_to_${to}.pdf`);
    } catch (e) {
      toast.error(`Couldn’t generate the report: ${apiError(e)}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="pinsights">
      <header className="pinsights__top">
        <div className="pinsights__ident">
          <div className="pinsights__thumb">
            {thumb ? <img src={thumb} alt="" /> : <span className="pinsights__thumb-fallback">🗂️</span>}
          </div>
          <div className="pinsights__ident-text">
            <div className="pinsights__eyebrow">Post insights</div>
            <h1 className="pinsights__title">{pageName} · Post #{post.id}</h1>
            <div className="pinsights__meta">{post.posted_at ? `Posted ${timeAgo(post.posted_at)}` : 'Not yet posted'}</div>
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Granularity">
          {GRANS.map((g) => (
            <button
              key={g.value}
              type="button"
              role="tab"
              aria-selected={gran === g.value}
              className={`seg__btn${gran === g.value ? ' is-active' : ''}`}
              onClick={() => setGran(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </header>

      <div className="pinsights__grid">
        <div className="pinsights__main">
          <div className="card card--pad pinsights__chartcard">
            <div className="pinsights__chart-head">
              <div className="pinsights__chart-title">Engagement per {granCfg.noun}</div>
              <div className="pinsights__chart-sub">
                {hasHistory ? `Click a ${granCfg.noun} to break it down on the right.` : `Compare how each metric performed across recent ${granCfg.noun}s.`}
              </div>
            </div>
            {hasHistory ? (
              <>
                <BarChart buckets={buckets} series={chartSeries} selectedKeys={selectedKeys} onSelect={selectBucket} />
                <div className="pinsights__note">
                  Followers and Page visits are the page’s daily totals during this post’s active period — Facebook’s
                  API has no per-post follows metric, so these can’t be attributed to a single post.
                </div>
              </>
            ) : (
              <div className="pinsights__empty">
                No history recorded yet. Insights are captured over time as the app syncs this post’s engagement —
                check back after a day or two.
              </div>
            )}
          </div>
        </div>

        <aside className="pinsights__side card card--pad">
          <div className="pinsights__side-head">
            <div className="pinsights__side-eyebrow">Selected range</div>
            <div className="pinsights__side-date">{effRange ? rangeLabel(effRange.from, effRange.to) : '—'}</div>
            {hasHistory && (
              <div className="pinsights__side-range">
                <label className="pinsights__side-field">
                  <span>From</span>
                  <input
                    className="input"
                    type="date"
                    value={effRange?.from || ''}
                    min={minDate || undefined}
                    max={effRange?.to || maxDate || undefined}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label className="pinsights__side-field">
                  <span>To</span>
                  <input
                    className="input"
                    type="date"
                    value={effRange?.to || ''}
                    min={effRange?.from || minDate || undefined}
                    max={maxDate || undefined}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </div>
            )}
            {hasHistory && (
              <Button
                className="btn--flat btn--block pinsights__side-download"
                size="sm"
                onClick={downloadReport}
                disabled={downloading}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {downloading ? 'Preparing…' : 'Download report'}
              </Button>
            )}
          </div>

          <ul className="pinsights__side-list">
            {rows.map((r) => (
              <li className="pinsights__side-row" key={r.key}>
                <span className="pinsights__side-dot" style={{ background: r.color }} />
                <span className="pinsights__side-label">{r.label}</span>
                <span className="pinsights__side-val">{fmtNum(r.value)}</span>
              </li>
            ))}
          </ul>

          {isVideo && (post.video_watch_time_s != null || post.video_avg_watch_s != null) && (
            <div className="pinsights__side-video">
              <div className="pinsights__side-subhead">Video · all-time</div>
              {post.video_watch_time_s != null && (
                <div className="pinsights__side-row">
                  <span className="pinsights__side-label">Watch time</span>
                  <span className="pinsights__side-val">{fmtWatch(post.video_watch_time_s)}</span>
                </div>
              )}
              {post.video_avg_watch_s != null && (
                <div className="pinsights__side-row">
                  <span className="pinsights__side-label">Avg play time</span>
                  <span className="pinsights__side-val">{fmtClock(post.video_avg_watch_s)}</span>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
