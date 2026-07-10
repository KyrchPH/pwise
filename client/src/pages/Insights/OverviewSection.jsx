import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as analytics from '../../services/analytics.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Spinner } from '../../components/ui.jsx';
import LineChart from '../../components/LineChart.jsx';

const CHART_COLOR = '#1f9be6';

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
};
const fmtExact = (n) => (Number(n) || 0).toLocaleString('en-US');
const fmtLong = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const fmtPostedAt = (v) => (v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
// Friendly post-type label. Callers pass post_kind ('reel') when set, else fall back
// to media_type ('image'|'video'|null). Photo / Video / Reels / Text are what the
// pool produces; 'story' is mapped too (stories live in their own view but reuse
// this label elsewhere).
const typeLabel = (t) => {
  switch (String(t || '').toLowerCase()) {
    case 'video': return 'Video';
    case 'reel':
    case 'reels': return 'Reels';
    case 'image':
    case 'photo': return 'Photo';
    case 'story': return 'Story';
    case '':
    case 'text': return 'Text';
    default: return t.charAt(0).toUpperCase() + t.slice(1);
  }
};

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

function InfoIcon({ text }) {
  return (
    <span className="perf-info" title={text} aria-label={text}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// A selectable headline tile (drives the main chart when active).
function MetricTile({ tile, active, onSelect }) {
  return (
    <button type="button" className={`msg-tile ${active ? 'is-active' : ''}`} onClick={() => onSelect(tile.key)} aria-pressed={active}>
      <span className="msg-tile__title">
        {tile.title}
        <InfoIcon text={tile.info} />
      </span>
      <span className="msg-tile__value-row">
        <span className="msg-tile__value">{tile.available ? fmtCompact(tile.total) : 'n/a'}</span>
        <Delta pct={tile.changePct} />
      </span>
    </button>
  );
}

export default function OverviewSection({ range }) {
  const { activeId } = usePages();
  const toast = useToast();
  const [selected, setSelected] = useState('views');

  const { data, loading, error } = useCachedResource(
    activeId ? `highlights:${range}:${activeId}` : `highlights:${range}:none`,
    () => analytics.highlights(range),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  if (loading && !data) return <Spinner label="Loading overview…" />;

  const tiles = data?.tiles || [];
  const activeTile = tiles.find((t) => t.key === selected) || tiles[0];
  const series = activeTile?.series || [];
  const topPosts = data?.topPosts || [];
  const rangeText = data ? `${fmtLong(data.sinceDate)} – ${fmtLong(data.untilDate)}` : '';

  return (
    <>
      <Card className="msg-insights">
        <div className="msg-insights__head ov-head">
          <div>
            <h2 className="msg-insights__title">Page overview</h2>
            <p className="msg-insights__sub">{rangeText || 'How your Page is doing at a glance.'}</p>
          </div>
          {data?.followers != null && (
            <div className="ov-followers">
              <span className="ov-followers__num">{fmtExact(data.followers)}</span>
              <span className="ov-followers__label">followers</span>
            </div>
          )}
        </div>

        <div className="msg-tiles">
          {tiles.map((t) => (
            <MetricTile key={t.key} tile={t} active={activeTile?.key === t.key} onSelect={setSelected} />
          ))}
        </div>

        <div className="msg-chart">
          {series.length >= 2 ? (
            <LineChart points={series} color={CHART_COLOR} label={activeTile?.title} wide />
          ) : (
            <div className="msg-chart__empty">
              {activeTile?.available === false ? 'No Available Data' : 'No daily trend for this period yet.'}
            </div>
          )}
        </div>
      </Card>

      <Card className="card--pad mt-lg">
        <div className="ov-posts__title">Top content in this period</div>
        {topPosts.length ? (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Type</th>
                  <th>Posted</th>
                  <th>Reactions</th>
                  <th>Comments</th>
                  <th>Shares</th>
                  <th>Engagement</th>
                </tr>
              </thead>
              <tbody>
                {topPosts.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-truncate" data-label="Post">
                      <Link to="/post-pool?view=posts">
                        #{p.id}
                        {p.caption ? ` — ${p.caption.slice(0, 60)}` : ''}
                      </Link>
                    </td>
                    <td data-label="Type">{typeLabel(p.post_kind === 'reel' ? 'reel' : p.media_type)}</td>
                    <td data-label="Posted">{fmtPostedAt(p.posted_at)}</td>
                    <td data-label="Reactions">{fmtCompact(p.reactions_count)}</td>
                    <td data-label="Comments">{fmtCompact(p.comments_count)}</td>
                    <td data-label="Shares">{fmtCompact(p.shares_count)}</td>
                    <td data-label="Engagement">
                      <strong>{fmtCompact(p.engagement)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ov-posts__empty">Nothing posted in this period yet.</div>
        )}
      </Card>
    </>
  );
}
