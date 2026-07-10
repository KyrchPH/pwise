import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import * as stories from '../../services/stories.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, EmptyState, HeartIcon, CommentIcon, ShareIcon, MediaThumb, Spinner, StatusBadge } from '../../components/ui.jsx';
import CreateContentMenu from '../../components/CreateContentMenu.jsx';

const STRIP_LIMIT = 8;
const POST_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'posts', label: 'Posts' },
  { key: 'reels', label: 'Reels' },
];

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
};

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

const postedTime = (item) => new Date(item.posted_at || item.created_at || 0).getTime();
const isReel = (post) => post.post_kind === 'reel';

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

function StripHeader({ title, sub, viewAllTo, actions }) {
  return (
    <div className="dash-strip__head">
      <div className="dash-strip__titlewrap">
        <h2 className="dash-strip__title">{title}</h2>
        {sub && <span className="dash-strip__sub">{sub}</span>}
      </div>
      <div className="dash-strip__head-end">
        {actions}
        <Link to={viewAllTo} className="dash-viewall">
          View all <span aria-hidden="true">-&gt;</span>
        </Link>
      </div>
    </div>
  );
}

export default function ContentsOverviewPage() {
  const toast = useToast();
  const { activeId, activePage } = usePages();
  const [postFilter, setPostFilter] = useState('all');

  const { data, loading, error } = useCachedResource(activeId ? `contents-overview:${activeId}` : null, () =>
    Promise.all([
      stories.list({ limit: 36 }),
      postPool.list({ status: 'posted', limit: 24 }),
    ]).then(([storyList, postList]) => ({
      stories: storyList?.stories || [],
      posts: postList?.posts || [],
    })),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  const recentStories = useMemo(
    () =>
      [...(data?.stories || [])]
        .filter((story) => story.status === 'posted')
        .sort((a, b) => postedTime(b) - postedTime(a))
        .slice(0, STRIP_LIMIT),
    [data],
  );

  const recentPosts = useMemo(() => {
    const items = [...(data?.posts || [])].sort((a, b) => postedTime(b) - postedTime(a));
    const filtered =
      postFilter === 'reels' ? items.filter(isReel) : postFilter === 'posts' ? items.filter((post) => !isReel(post)) : items;
    return filtered.slice(0, STRIP_LIMIT);
  }, [data, postFilter]);

  if (!activeId) {
    return <EmptyState title="No page selected" message="Choose a connected page to see its content overview." />;
  }
  if (loading && !data) return <Spinner label="Loading contents overview..." />;
  if (!data) return null;

  return (
    <>
      <div className="page-head contents-head">
        <div>
          <h1 className="page-head__title">Contents</h1>
          <div className="page-head__sub">
            {activePage?.account_name ? `${activePage.account_name} - ` : ''}
            Recent stories, posts, and reels.
          </div>
        </div>
        <div className="row contents-head__actions">
          <CreateContentMenu />
        </div>
      </div>

      <Card className="card--pad dash-strip contents-overview__section contents-overview__panel contents-overview__panel--posts">
        <StripHeader
          title="Recent posts & reels"
          sub="Latest published content"
          viewAllTo="/post-pool?view=posts"
          actions={
            <div className="contents-overview__filter" role="group" aria-label="Filter recent content">
              {POST_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={`contents-overview__filter-btn${postFilter === filter.key ? ' is-active' : ''}`}
                  onClick={() => setPostFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          }
        />
        {recentPosts.length ? (
          <div className="dash-strip__rail">
            {recentPosts.map((post) => (
              <MediaTeaser
                key={post.id}
                to="/post-pool?view=posts"
                mediaUrl={post.media_preview_url}
                mediaType={post.media_type}
                thumbnailUrl={post.thumbnail_preview_url}
                tag={isReel(post) ? 'Reel' : null}
                tagClass="dash-media__tag--reel"
                caption={post.caption ? post.caption.slice(0, 70) : <span className="text-muted">No caption</span>}
                meta={
                  post.engagement_synced_at ? (
                    <>
                      <span className="dash-media__stat" title="Reactions"><HeartIcon size={14} /> {fmtCompact(post.reactions_count)}</span>
                      <span className="dash-media__stat" title="Comments"><CommentIcon size={14} /> {fmtCompact(post.comments_count)}</span>
                      <span className="dash-media__stat" title="Shares"><ShareIcon size={14} /> {fmtCompact(post.shares_count)}</span>
                    </>
                  ) : (
                    <span className="text-muted">Syncing...</span>
                  )
                }
                foot={timeAgo(post.posted_at)}
              />
            ))}
          </div>
        ) : (
          <div className="dash-strip__empty">
            No {postFilter === 'all' ? 'posts or reels' : postFilter} published yet.
          </div>
        )}
      </Card>

      <Card className="card--pad dash-strip contents-overview__section contents-overview__panel contents-overview__panel--stories mt-lg">
        <StripHeader
          title="Recent stories"
          sub="24-hour Facebook & Instagram stories"
          viewAllTo="/post-pool?view=stories"
        />
        {recentStories.length ? (
          <div className="dash-strip__rail">
            {recentStories.map((story) => (
              <MediaTeaser
                key={story.id}
                to="/post-pool?view=stories"
                mediaUrl={story.media_preview_url}
                mediaType={story.media_type}
                thumbnailUrl={story.thumbnail_preview_url}
                tag={story.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                tagClass={`dash-media__tag--${story.platform}`}
                meta={<StatusBadge status={story.status} />}
                foot={timeAgo(story.posted_at || story.created_at)}
              />
            ))}
          </div>
        ) : (
          <div className="dash-strip__empty">No posted stories yet.</div>
        )}
      </Card>
    </>
  );
}
