import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as analytics from '../../services/analytics.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Card, Spinner } from '../../components/ui.jsx';

const fmtExact = (n) => (Number(n) || 0).toLocaleString('en-US');
const fmtPublished = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
const typeLabel = (t) => (t === 'video' ? 'Video' : t === 'image' ? 'Photo' : t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Post');

// Media-type filter options (post_pool only stores image | video).
const MEDIA_FILTERS = [
  { key: 'all', label: 'All media' },
  { key: 'image', label: 'Photos' },
  { key: 'video', label: 'Videos' },
];

// Numeric/date columns, in display order. `key` matches the post field; dates sort by time.
const COLUMNS = [
  { key: 'postedAt', label: 'Published', kind: 'date', info: 'When this post went live.' },
  { key: 'views', label: 'Views', kind: 'num', info: 'Times this post was on screen.' },
  { key: 'interactions', label: 'Interactions', kind: 'num', info: 'Reactions, comments and shares on this post.' },
  { key: 'reactions', label: 'Reactions', kind: 'num', info: 'Likes and other reactions on this post.' },
  { key: 'comments', label: 'Comments', kind: 'num', info: 'Comments left on this post.' },
  { key: 'shares', label: 'Shares', kind: 'num', info: 'Times this post was shared.' },
];

function InfoIcon({ text }) {
  return (
    <span className="perf-info" title={text} aria-label={text}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SortArrow({ state }) {
  // state: 'asc' | 'desc' | null (inactive)
  return (
    <span className={`cperf-sort__arrow${state ? ' is-active' : ''}`} aria-hidden="true">
      {state === 'asc' ? '↑' : state === 'desc' ? '↓' : '↕'}
    </span>
  );
}

// Small square thumbnail with a media-type glyph fallback.
function Thumb({ post }) {
  const [broken, setBroken] = useState(false);
  if (post.thumbnailUrl && !broken) {
    return (
      <span className="cperf-thumb">
        <img src={post.thumbnailUrl} alt="" onError={() => setBroken(true)} />
        {post.mediaType === 'video' && <span className="cperf-thumb__play">▶</span>}
      </span>
    );
  }
  return (
    <span className="cperf-thumb cperf-thumb--empty" aria-hidden="true">
      {post.mediaType === 'video' ? '🎬' : '🖼️'}
    </span>
  );
}

export default function ContentsSection({ range }) {
  const { activeId } = usePages();
  const toast = useToast();
  const [mediaFilter, setMediaFilter] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'postedAt', dir: 'desc' });

  const { data, loading, error } = useCachedResource(
    activeId ? `contents:${range}:${activeId}` : `contents:${range}:none`,
    () => analytics.contents(range),
  );

  const posts = useMemo(() => data?.posts || [], [data]);

  // Filter (media type + search) then sort by the active column.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = posts.filter((p) => {
      if (mediaFilter !== 'all' && p.mediaType !== mediaFilter) return false;
      if (!needle) return true;
      return String(p.id).includes(needle) || (p.caption || '').toLowerCase().includes(needle);
    });
    const val = (p) => (sort.key === 'postedAt' ? new Date(p.postedAt).getTime() || 0 : Number(p[sort.key]) || 0);
    return filtered.slice().sort((a, b) => (sort.dir === 'asc' ? val(a) - val(b) : val(b) - val(a)));
  }, [posts, mediaFilter, q, sort]);

  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  if (loading && !data) return <Spinner label="Loading contents…" />;
  if (error && !data) {
    return (
      <Card className="card--pad">
        <div className="ov-posts__empty">{apiError(error)}</div>
      </Card>
    );
  }

  return (
    <Card className="card--pad cperf">
      <div className="cperf-toolbar">
        <div className="seg" role="tablist" aria-label="Media type">
          {MEDIA_FILTERS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`seg__btn ${mediaFilter === m.key ? 'is-active' : ''}`}
              onClick={() => setMediaFilter(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="cperf-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID or caption" aria-label="Search by ID or caption" />
        </label>
        <Button as={Link} to="/upload" size="sm" className="cperf-create btn--flat">
          + Create post
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="ov-posts__empty">
          {posts.length ? 'No posts match your filters.' : 'Nothing published in this period yet.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table cperf-table">
            <thead>
              <tr>
                <th className="cperf-th-content">Content</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={`cperf-th-num${sort.key === c.key ? ' is-sorted' : ''}`}>
                    <button type="button" className="cperf-sort" onClick={() => onSort(c.key)}>
                      <span>{c.label}</span>
                      <InfoIcon text={c.info} />
                      <SortArrow state={sort.key === c.key ? sort.dir : null} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="cperf-content">
                    <a
                      className="cperf-post"
                      href={`/post/${p.id}/insights`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open post insights in a new tab"
                    >
                      <Thumb post={p} />
                      <span className="cperf-post__text">
                        <span className="cperf-caption">{p.caption?.trim() || `Post #${p.id}`}</span>
                        <span className="cperf-sub">
                          <span className="cperf-type">{typeLabel(p.mediaType)}</span>
                          <span className="cperf-sub__dot">·</span>
                          <span>#{p.id}</span>
                        </span>
                      </span>
                    </a>
                  </td>
                  <td className="cperf-num cperf-num--muted">{fmtPublished(p.postedAt)}</td>
                  <td className="cperf-num">{fmtExact(p.views)}</td>
                  <td className="cperf-num">
                    <strong>{fmtExact(p.interactions)}</strong>
                  </td>
                  <td className="cperf-num">{fmtExact(p.reactions)}</td>
                  <td className="cperf-num">{fmtExact(p.comments)}</td>
                  <td className="cperf-num">{fmtExact(p.shares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
