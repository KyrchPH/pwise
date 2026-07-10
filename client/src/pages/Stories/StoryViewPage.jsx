import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as stories from '../../services/stories.service.js';
import { apiError } from '../../services/api.js';
import { usePages } from '../../context/PageContext.jsx';
import { Spinner, StatusBadge } from '../../components/ui.jsx';

// Full-width viewer for a single story: the 9:16 media on the left, its live
// insights beside it on the right. Opened by pressing a card in the Stories grid
// (Contents → Stories). Insights are Instagram-only — Facebook page stories have
// no per-story metric — so the panel degrades to an honest note when unavailable.

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram' };
const fmtNum = (v) => Number(v || 0).toLocaleString();

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

function expiresIn(iso) {
  if (!iso) return null;
  const left = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(left) || left <= 0) return null;
  const mins = Math.ceil(left / 60000);
  if (mins < 60) return `Expires in ${mins}m`;
  return `Expires in ${Math.round(mins / 60)}h`;
}

const isExpired = (story) =>
  story?.status === 'posted' && story?.expires_at && new Date(story.expires_at).getTime() <= Date.now();

function PlatformLogo({ platform }) {
  const key = String(platform || '').toLowerCase();
  const label = PLATFORM_LABELS[key] || platform || 'Platform';
  if (key === 'facebook') {
    return (
      <span className="story-view__logo" title={label} aria-label={label}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#1877F2" />
          <path
            d="M15.5 12.5l.4-2.6h-2.5V8.2c0-.7.35-1.4 1.45-1.4h1.15V4.6s-1.05-.18-2.05-.18c-2.1 0-3.45 1.27-3.45 3.56v2.02H8.2v2.6h2.25V19h2.95v-6.5z"
            fill="#fff"
          />
        </svg>
      </span>
    );
  }
  if (key === 'instagram') {
    return (
      <span className="story-view__logo story-view__logo--instagram" title={label} aria-label={label}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="5" y="5" width="14" height="14" rx="4" />
          <circle cx="12" cy="12" r="3" />
          <circle cx="16.5" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  return (
    <span className="story-view__logo story-view__logo--unknown" title={label} aria-label={label}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

// The vertical media itself: video plays with controls (poster = the grid still);
// an image just fills the 9:16 frame. Falls back to a glyph if neither loads.
function StoryStage({ story }) {
  const [broken, setBroken] = useState(false);
  const media = story.media_preview_url;
  const poster = story.thumbnail_preview_url || undefined;

  if (media && !broken) {
    if (story.media_type === 'video') {
      return (
        <video
          className="story-view__media"
          src={media}
          poster={poster}
          controls
          playsInline
          onError={() => setBroken(true)}
        />
      );
    }
    return <img className="story-view__media" src={media} alt="Story media" onError={() => setBroken(true)} />;
  }
  return (
    <div className="story-view__media story-view__media--empty">
      <span aria-hidden="true">{story.media_type === 'video' ? '🎬' : '🖼️'}</span>
      <span>Media unavailable</span>
    </div>
  );
}

// Right rail: metric cards when Instagram returns numbers, otherwise an honest
// explanation (Facebook has no per-story metric; or IG hasn't answered yet).
function InsightsPanel({ loading, data }) {
  if (loading) {
    return (
      <div className="story-view__insights-empty">
        <Spinner label="Loading insights…" />
      </div>
    );
  }
  const metrics = data?.metrics ?? [];
  if (!data?.supported || metrics.length === 0) {
    return (
      <div className="story-view__insights-empty">
        <div className="story-view__insights-empty-title">No insights to show</div>
        <p className="story-view__insights-empty-msg">
          {data?.note || 'Insights aren’t available for this story yet.'}
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="story-view__metrics">
        {metrics.map((m) => (
          <div className="story-view__metric" key={m.key}>
            <div className="story-view__metric-value">{fmtNum(m.value)}</div>
            <div className="story-view__metric-label">{m.label}</div>
            {m.hint && <div className="story-view__metric-hint">{m.hint}</div>}
          </div>
        ))}
      </div>
      <div className="story-view__insights-note">
        Numbers are pulled live from {data.platform === 'instagram' ? 'Instagram' : 'Meta'} and can lag a little
        behind real time.
      </div>
    </>
  );
}

export default function StoryViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { pages, activePage } = usePages();
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  // Load the story (media) and its insights independently — the media shouldn't
  // wait on a slow/failing Graph call.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setInsightsLoading(true);
    setInsights(null);
    stories
      .get(id)
      .then((s) => {
        if (alive) setStory(s);
      })
      .catch((e) => {
        if (alive) setError(e);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    stories
      .insights(id)
      .then((d) => {
        if (alive) setInsights(d);
      })
      .catch(() => {
        if (alive) setInsights({ supported: false, metrics: [], note: null });
      })
      .finally(() => {
        if (alive) setInsightsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    document.title = story ? `Story #${story.id} · ${PLATFORM_LABELS[story.platform] || 'Story'}` : 'Story';
  }, [story]);

  const pageName = useMemo(() => {
    if (!story) return activePage?.account_name || 'Your Page';
    return pages.find((p) => p.id === story.account_id)?.account_name || activePage?.account_name || 'Your Page';
  }, [story, pages, activePage]);

  const backLink = '/post-pool?view=stories';

  if (loading) {
    return (
      <div className="story-view">
        <div className="story-view__loading">
          <Spinner label="Loading story…" />
        </div>
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="story-view">
        <div className="story-view__loading">
          <div className="story-view__error">
            <div className="story-view__error-title">Couldn’t open this story</div>
            <div className="story-view__error-sub">{error ? apiError(error) : 'The story could not be found.'}</div>
            <Link to={backLink} className="btn btn--flat story-view__error-back">
              ← Back to Stories
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const expired = isExpired(story);
  const countdown = !expired && story.status === 'posted' ? expiresIn(story.expires_at) : null;
  const postedLine =
    story.status === 'posted'
      ? `Posted ${timeAgo(story.posted_at)}`
      : story.status === 'posting'
        ? 'Publishing…'
        : `Created ${timeAgo(story.created_at)}`;

  return (
    <div className="story-view">
      <div className="story-view__stage">
      <header className="story-view__top">
        <button type="button" className="story-view__back" onClick={() => navigate(backLink)} aria-label="Back to Stories">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Stories</span>
        </button>
        <div className="story-view__ident">
          <PlatformLogo platform={story.platform} />
          <div className="story-view__ident-text">
            <div className="story-view__eyebrow">{PLATFORM_LABELS[story.platform] || 'Story'} story</div>
            <h1 className="story-view__title">{pageName} · Story #{story.id}</h1>
            <div className="story-view__meta">
              <span>{postedLine}</span>
              {countdown && <span className="story-view__meta-sub">· {countdown}</span>}
            </div>
          </div>
        </div>
        <StatusBadge status={expired ? 'expired' : story.status} />
      </header>

        <div className="story-view__canvas">
          <div className="story-view__player">
            <div className={`story-view__frame${expired ? ' is-expired' : ''}`}>
              <StoryStage story={story} />
            </div>
            {story.status === 'failed' && story.failed_reason && (
              <div className="story-view__failed" title={story.failed_reason}>
                {story.failed_reason}
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="story-view__side">
        <div className="story-view__side-head">
            <div className="story-view__side-eyebrow">Story insights</div>
            <div className="story-view__side-title">Performance</div>
          </div>

          <InsightsPanel loading={insightsLoading} data={insights} />

          <dl className="story-view__facts">
            <div className="story-view__fact">
              <dt>Platform</dt>
              <dd>{PLATFORM_LABELS[story.platform] || story.platform}</dd>
            </div>
            <div className="story-view__fact">
              <dt>Media</dt>
              <dd>{story.media_type === 'video' ? 'Video' : 'Image'}</dd>
            </div>
            <div className="story-view__fact">
              <dt>Status</dt>
              <dd>{expired ? 'Expired' : story.status.charAt(0).toUpperCase() + story.status.slice(1)}</dd>
            </div>
            {story.posted_at && (
              <div className="story-view__fact">
                <dt>Posted</dt>
                <dd>{new Date(story.posted_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
              </div>
            )}
            {story.expires_at && (
              <div className="story-view__fact">
                <dt>{expired ? 'Expired' : 'Expires'}</dt>
                <dd>{new Date(story.expires_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
              </div>
            )}
          </dl>
      </aside>
    </div>
  );
}
