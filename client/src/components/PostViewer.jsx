import { useCallback, useEffect, useRef, useState } from 'react';
import { Linkify, HeartIcon, CommentIcon, ShareIcon, EyeIcon } from './ui.jsx';
import * as postPool from '../services/post_pool.service.js';
import { apiError } from '../services/api.js';

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Compact counts: 1234 -> "1.2k", 1_500_000 -> "1.5M".
const fmtNum = (n) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
};

// Live Facebook comments for a published post. The first page loads when the
// viewer opens; more pages lazy-load as you scroll near the bottom. Shows each
// comment's text + time — Facebook withholds the commenter's identity (`from`)
// for ordinary users (privacy), so author names aren't available.
function CommentsSection({ post }) {
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(null);
  const scrollerRef = useRef(null);
  const cursorRef = useRef(null); // mirror of `cursor` for the scroll handler (no stale closure)
  const loadingRef = useRef(false);

  const canHaveComments = post.status === 'posted' && post.platform_post_id;

  const fetchPage = useCallback(
    async (after) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const { comments: page, nextCursor } = await postPool.comments(post.id, after);
        setComments((prev) => (after ? [...prev, ...page] : page));
        cursorRef.current = nextCursor;
        setCursor(nextCursor);
        setLoadedOnce(true);
      } catch (err) {
        setError(apiError(err));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [post.id],
  );

  useEffect(() => {
    setComments([]);
    setCursor(null);
    cursorRef.current = null;
    setLoadedOnce(false);
    setError(null);
    if (canHaveComments) fetchPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  if (!canHaveComments) return null;

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || loadingRef.current || !cursorRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) fetchPage(cursorRef.current);
  };

  return (
    <div className="post-comments">
      <div className="post-comments__head">Comments</div>
      <div className="post-comments__list" ref={scrollerRef} onScroll={onScroll}>
        {comments.map((c) => (
          <div className="comment" key={c.id}>
            <div className="comment__body">{c.message || <em className="text-muted">(no text)</em>}</div>
            <div className="comment__time">{fmt(c.created_time)}</div>
          </div>
        ))}
        {loading && <div className="post-comments__status">Loading…</div>}
        {error && <div className="post-comments__status post-comments__status--error">{error}</div>}
        {loadedOnce && !loading && !error && comments.length === 0 && (
          <div className="post-comments__status">No comments yet.</div>
        )}
        {loadedOnce && !loading && !cursor && comments.length > 0 && (
          <div className="post-comments__status">— end of comments —</div>
        )}
      </div>
    </div>
  );
}

/**
 * Full-screen, Facebook-style post viewer: the media fills a dark stage on the
 * left, with a white info panel (author, caption, scheduling details) docked
 * full-height on the right. Renders nothing when `post` is null.
 */
export default function PostViewer({ post, onClose, onEdit }) {
  // Close on Escape and lock background scroll while open.
  useEffect(() => {
    if (!post) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [post, onClose]);

  if (!post) return null;

  const when = post.posted_at
    ? `Posted ${fmt(post.posted_at)}`
    : post.scheduled_at
      ? `Scheduled ${fmt(post.scheduled_at)}`
      : 'Not scheduled';

  return (
    <div className="post-viewer" role="dialog" aria-modal="true" aria-label={`Post ${post.id}`}>
      <button className="post-viewer__close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      <div className="post-viewer__stage">
        {post.media_preview_url ? (
          post.media_type === 'video' ? (
            <video src={post.media_preview_url} controls />
          ) : (
            <img src={post.media_preview_url} alt="" />
          )
        ) : (
          <div className="post-viewer__nomedia">
            <span aria-hidden="true">📝</span>
            <span>Text-only post</span>
          </div>
        )}
      </div>

      <aside className="post-viewer__panel">
        {/* Author header — mimics a Facebook post header */}
        <div className="post-author">
          <img
            className="post-author__avatar"
            src="/logo.jpg"
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div>
            <div className="post-author__name">
              Wise Cleaner Shop
              <svg
                className="post-author__badge"
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <path d="M12 3c3.5 2.7 3.5 15.3 0 18c-3.5-2.7-3.5-15.3 0-18z" />
              </svg>
            </div>
            <div className="post-author__meta">
              <span style={{ textTransform: 'capitalize' }}>{post.status}</span>
              <span>·</span>
              <span>{when}</span>
            </div>
          </div>
          <button className="post-author__edit" onClick={() => onEdit(post)} aria-label="Edit post" title="Edit post">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        </div>

        {/* Caption — the post body */}
        <div className="post-view__caption">
          {post.caption ? <Linkify text={post.caption} /> : <em className="text-muted">No caption</em>}
        </div>

        {/* Engagement pulled back from the platform (shown once synced) */}
        {post.engagement_synced_at && (
          <div className="post-stats">
            <div className="post-stats__row">
              <span className="post-stats__item" title="Reactions">
                <HeartIcon size={16} />{fmtNum(post.reactions_count)}
              </span>
              <span className="post-stats__item" title="Comments">
                <CommentIcon size={16} />{fmtNum(post.comments_count)}
              </span>
              <span className="post-stats__item" title="Shares">
                <ShareIcon size={16} />{fmtNum(post.shares_count)}
              </span>
              {post.media_type === 'video' && (
                <span className="post-stats__item" title="Views">
                  <EyeIcon size={16} />{fmtNum(post.views_count)}
                </span>
              )}
            </div>
            <div className="post-stats__synced">Updated {fmt(post.engagement_synced_at)}</div>
          </div>
        )}

        {/* Live comments from Facebook — first page on open, lazy-load on scroll */}
        <CommentsSection post={post} />
      </aside>
    </div>
  );
}
