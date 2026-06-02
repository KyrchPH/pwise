import { useEffect } from 'react';
import { Linkify } from './ui.jsx';

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
                <span aria-hidden="true">❤️</span> {fmtNum(post.reactions_count)}
              </span>
              <span className="post-stats__item" title="Comments">
                <span aria-hidden="true">💬</span> {fmtNum(post.comments_count)}
              </span>
              <span className="post-stats__item" title="Shares">
                <span aria-hidden="true">🔁</span> {fmtNum(post.shares_count)}
              </span>
              {post.media_type === 'video' && (
                <span className="post-stats__item" title="Views">
                  <span aria-hidden="true">▶️</span> {fmtNum(post.views_count)}
                </span>
              )}
            </div>
            <div className="post-stats__synced">Updated {fmt(post.engagement_synced_at)}</div>
          </div>
        )}
      </aside>
    </div>
  );
}
