import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Linkify, HeartIcon, CommentIcon, ShareIcon, EyeIcon, Button } from './ui.jsx';
import InsightsDrawer from './InsightsDrawer.jsx';
import DockedChat from './DockedChat.jsx';
import * as postPool from '../services/post_pool.service.js';
import { usePages } from '../context/PageContext.jsx';
import { apiError } from '../services/api.js';

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="M7 13l3.5-3.5 3 3L19 7" />
  </svg>
);

const MessageIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

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

// Label beside a stat count — singular when the raw count is exactly 1.
const plural = (n, word) => `${word}${Number(n) === 1 ? '' : 's'}`;

// Live Facebook comments for a published post. The first page loads when the
// viewer opens; more pages lazy-load as you scroll near the bottom. Shows each
// comment's text + time — Facebook withholds the commenter's identity (`from`)
// for ordinary users (privacy), so author names aren't available.
function CommentsSection({ post, onDeleted, onMessageComment, onOpenConversation, sessionMessaged = {} }) {
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(null);
  // Reply composer: which comment is open, its draft, busy/error, and the replies we
  // posted this session (Facebook won't echo our reply back into the comments list).
  const [replyOpenId, setReplyOpenId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState(null);
  const [sentReplies, setSentReplies] = useState({}); // { [commentId]: [{ id, message }] }
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
        const { comments: page, nextCursor, postDeleted } = await postPool.comments(post.id, after);
        if (postDeleted) {
          onDeleted?.(); // the post was removed on Facebook → the viewer shows the dialog
          setLoadedOnce(true);
        } else {
          setComments((prev) => (after ? [...prev, ...page] : page));
          cursorRef.current = nextCursor;
          setCursor(nextCursor);
          setLoadedOnce(true);
        }
      } catch (err) {
        setError(apiError(err));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [post.id, onDeleted],
  );

  useEffect(() => {
    setComments([]);
    setCursor(null);
    cursorRef.current = null;
    setLoadedOnce(false);
    setError(null);
    setReplyOpenId(null);
    setReplyText('');
    setReplyError(null);
    setSentReplies({});
    if (canHaveComments) fetchPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  if (!canHaveComments) return null;

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || loadingRef.current || !cursorRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) fetchPage(cursorRef.current);
  };

  const openReply = (commentId) => {
    setReplyOpenId(commentId);
    setReplyText('');
    setReplyError(null);
  };
  const cancelReply = () => {
    setReplyOpenId(null);
    setReplyText('');
    setReplyError(null);
  };
  const submitReply = async (commentId) => {
    const body = replyText.trim();
    if (!body) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const { id } = await postPool.replyToComment(post.id, commentId, body);
      setSentReplies((prev) => ({
        ...prev,
        [commentId]: [...(prev[commentId] || []), { id: id || `local-${(prev[commentId] || []).length}`, message: body }],
      }));
      cancelReply();
    } catch (err) {
      setReplyError(apiError(err));
    } finally {
      setReplyBusy(false);
    }
  };

  return (
    <div className="post-comments">
      <div className="post-comments__head">Comments</div>
      <div className="post-comments__list" ref={scrollerRef} onScroll={onScroll}>
        {comments.map((c) => (
          <div className="comment" key={c.id}>
            <div className="comment__body">{c.message || <em className="text-muted">(no text)</em>}</div>
            <div className="comment__time">{fmt(c.created_time)}</div>

            {(sentReplies[c.id] || []).map((r) => (
              <div className="comment__reply" key={r.id}>
                <span className="comment__reply-badge">You</span>
                <span className="comment__reply-body">{r.message}</span>
              </div>
            ))}

            {replyOpenId === c.id ? (
              <div className="comment__reply-form">
                <textarea
                  className="textarea comment__reply-input"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply…"
                  rows={2}
                  autoFocus
                  disabled={replyBusy}
                />
                {replyError && (
                  <div className="post-comments__status post-comments__status--error">{replyError}</div>
                )}
                <div className="comment__reply-actions">
                  <Button type="button" variant="ghost" size="sm" onClick={cancelReply} disabled={replyBusy}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="btn--flat"
                    onClick={() => submitReply(c.id)}
                    disabled={replyBusy || !replyText.trim()}
                  >
                    {replyBusy ? 'Sending…' : 'Reply'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="comment__actions">
                <button type="button" className="comment__reply-btn" onClick={() => openReply(c.id)}>
                  Reply
                </button>
                {c.conversationId || sessionMessaged[c.id] ? (
                  <button
                    type="button"
                    className="comment__reply-btn comment__msg-btn comment__msg-btn--done"
                    onClick={() => onOpenConversation?.(c.conversationId || sessionMessaged[c.id])}
                    title="Open the conversation in Messaging"
                  >
                    <MessageIcon /> Messaged
                  </button>
                ) : (
                  <button
                    type="button"
                    className="comment__reply-btn comment__msg-btn"
                    onClick={() => onMessageComment?.(c.id)}
                    title="Message this commenter privately"
                  >
                    <MessageIcon /> Message
                  </button>
                )}
              </div>
            )}
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
export default function PostViewer({ post, onClose, onEdit, onRetry, onDelete, onDeletedOnFacebook }) {
  const { activePage } = usePages();
  const navigate = useNavigate();
  const [showInsights, setShowInsights] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [deletedDialog, setDeletedDialog] = useState(false); // post was removed on Facebook
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [dockedChat, setDockedChat] = useState(null); // { postId, commentId, prefill } — commenter DM
  const [sessionMessaged, setSessionMessaged] = useState({}); // { [commentId]: conversationId } this session
  // Engagement counts shown in the viewer. Seeded from the (possibly stale) list
  // snapshot, then force-refreshed live on open so they match the live comments list.
  const [stats, setStats] = useState(() => ({
    reactions_count: post?.reactions_count,
    comments_count: post?.comments_count,
    shares_count: post?.shares_count,
    views_count: post?.views_count,
    engagement_synced_at: post?.engagement_synced_at,
  }));

  // Open the docked mini-chat to message a commenter, prefilled with the page's default.
  const openMessageCommenter = (commentId) =>
    setDockedChat({ postId: post.id, commentId, prefill: activePage?.comment_dm_default_message || '' });

  // "Messaged" → jump to the existing conversation in Messaging (closes the viewer).
  const openConversation = (conversationId) => {
    if (!conversationId) return;
    const page = activePage?.id != null ? `&page=${activePage.id}` : '';
    navigate(`/messages?c=${conversationId}${page}`);
    onClose?.();
  };

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

  // Reset transient UI when switching posts. Open the "deleted on Facebook" dialog
  // up front if the post is already marked deleted (detected on a prior view).
  useEffect(() => {
    setShowInsights(false);
    setRetryBusy(false);
    setDeleteBusy(false);
    setDockedChat(null);
    setSessionMessaged({});
    setDeletedDialog(post?.status === 'deleted');
  }, [post?.id, post?.status]);

  // Force a fresh engagement pull when the viewer opens (bypassing the server's 5-min
  // TTL), so the counts match the live comments instead of the last list-load snapshot.
  useEffect(() => {
    if (!post) return undefined;
    setStats({
      reactions_count: post.reactions_count,
      comments_count: post.comments_count,
      shares_count: post.shares_count,
      views_count: post.views_count,
      engagement_synced_at: post.engagement_synced_at,
    });
    if (post.status !== 'posted' || !post.platform_post_id) return undefined;
    let cancelled = false;
    postPool
      .get(post.id, { refresh: true })
      .then((fresh) => {
        if (cancelled || !fresh) return;
        setStats({
          reactions_count: fresh.reactions_count,
          comments_count: fresh.comments_count,
          shares_count: fresh.shares_count,
          views_count: fresh.views_count,
          engagement_synced_at: fresh.engagement_synced_at,
        });
      })
      .catch(() => {}); // best-effort: keep the seeded snapshot on failure
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  if (!post) return null;

  const when = post.posted_at
    ? `Posted ${fmt(post.posted_at)}`
    : post.scheduled_at
      ? `Scheduled ${fmt(post.scheduled_at)}`
      : 'Not scheduled';

  const retryable = post.status === 'failed' || post.status === 'expired';
  const onRetryClick = async () => {
    if (retryBusy || !onRetry) return;
    setRetryBusy(true);
    try {
      await onRetry(post);
    } finally {
      setRetryBusy(false);
    }
  };

  // The comments fetch discovered the post is gone on Facebook (now marked
  // 'deleted' server-side): open the dialog and let the parent refresh the list.
  const onDeletedDetected = () => {
    setDeletedDialog(true);
    onDeletedOnFacebook?.(post);
  };
  // Dialog actions — "Re-post" re-publishes; "Delete post" removes it. Both are
  // handled by the parent, which closes the viewer on success.
  const repostFromDialog = async () => {
    if (retryBusy || deleteBusy || !onRetry) return;
    setRetryBusy(true);
    try {
      await onRetry(post);
    } finally {
      setRetryBusy(false);
    }
  };
  const deleteFromDialog = async () => {
    if (deleteBusy || retryBusy || !onDelete) return;
    setDeleteBusy(true);
    try {
      await onDelete(post);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="post-viewer" role="dialog" aria-modal="true" aria-label={`Post ${post.id}`}>
      <button className="post-viewer__close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {post.status === 'posted' && post.platform_post_id && (
        <button className="post-viewer__insights" onClick={() => setShowInsights(true)} title="View insights">
          <ChartIcon />
          <span>Insights</span>
        </button>
      )}

      <div className="post-viewer__stage">
        {post.media_preview_url ? (
          post.media_type === 'video' ? (
            // Show the optimized thumbnail as the poster and hold off downloading
            // the clip until the viewer hits play.
            <video
              src={post.media_preview_url}
              poster={post.thumbnail_preview_url || undefined}
              preload={post.thumbnail_preview_url ? 'none' : 'metadata'}
              controls
            />
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
            src="/logo.png"
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

        {/* Failure notice + retry, for posts that didn't go out */}
        {retryable && (
          <div className="post-view__retry" style={{ marginBottom: 12 }}>
            {post.failed_reason && (
              <div className="error-text" style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                {post.failed_reason}
              </div>
            )}
            <Button variant="ghost" onClick={onRetryClick} disabled={retryBusy}>
              {retryBusy ? 'Retrying…' : '↻ Retry now'}
            </Button>
          </div>
        )}

        {/* Caption — the post body */}
        <div className="post-view__caption">
          {post.caption ? <Linkify text={post.caption} /> : <em className="text-muted">No caption</em>}
        </div>

        {/* Engagement pulled back from the platform (shown once synced) */}
        {stats.engagement_synced_at && (
          <div className="post-stats">
            <div className="post-stats__row">
              <span className="post-stats__item" title="Reactions">
                <HeartIcon size={16} />{fmtNum(stats.reactions_count)}
                <span className="post-stats__label">{plural(stats.reactions_count, 'Reaction')}</span>
              </span>
              <span className="post-stats__item" title="Comments">
                <CommentIcon size={16} />{fmtNum(stats.comments_count)}
                <span className="post-stats__label">{plural(stats.comments_count, 'Comment')}</span>
              </span>
              <span className="post-stats__item" title="Shares">
                <ShareIcon size={16} />{fmtNum(stats.shares_count)}
                <span className="post-stats__label">{plural(stats.shares_count, 'Share')}</span>
              </span>
              {post.media_type === 'video' && (
                <span className="post-stats__item" title="Views">
                  <EyeIcon size={16} />{fmtNum(stats.views_count)}
                  <span className="post-stats__label">{plural(stats.views_count, 'View')}</span>
                </span>
              )}
            </div>
            <div className="post-stats__synced">Updated {fmt(stats.engagement_synced_at)}</div>
          </div>
        )}

        {/* Live comments from Facebook — first page on open, lazy-load on scroll */}
        <CommentsSection
          post={post}
          onDeleted={onDeletedDetected}
          onMessageComment={openMessageCommenter}
          onOpenConversation={openConversation}
          sessionMessaged={sessionMessaged}
        />
      </aside>

      <InsightsDrawer post={post} open={showInsights} onClose={() => setShowInsights(false)} />

      <DockedChat
        chat={dockedChat}
        onClose={() => setDockedChat(null)}
        onOpened={(commentId, cid) => setSessionMessaged((m) => ({ ...m, [commentId]: cid }))}
      />

      {/* Shown when the post no longer exists on Facebook (deleted there). Rendered
          inside the viewer so it sits above it (a normal Modal would fall behind). */}
      {deletedDialog && (
        <div className="post-viewer__dialog-overlay" role="dialog" aria-modal="true" aria-label="Post deleted on Facebook">
          <div className="post-viewer__dialog">
            <h3>Post deleted on Facebook</h3>
            <p>This post has been deleted in Facebook. You can delete the post or re-post it.</p>
            <div className="post-viewer__dialog-actions">
              <Button variant="ghost" onClick={() => setDeletedDialog(false)} disabled={retryBusy || deleteBusy}>
                Close
              </Button>
              <Button variant="danger" onClick={deleteFromDialog} disabled={retryBusy || deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Delete post'}
              </Button>
              <Button onClick={repostFromDialog} disabled={retryBusy || deleteBusy}>
                {retryBusy ? 'Re-posting…' : 'Re-post'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
