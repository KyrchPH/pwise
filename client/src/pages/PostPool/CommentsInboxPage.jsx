import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as postPool from '../../services/post_pool.service.js';
import { apiError } from '../../services/api.js';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { usePages } from '../../context/PageContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Card, Spinner, EmptyState, Linkify, PageAvatar, HeartIcon, CommentIcon, ShareIcon } from '../../components/ui.jsx';
import DockedChat from '../../components/DockedChat.jsx';
import { subscribeComments } from '../../services/comment_stream.service.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Unread' },
  { key: 'done', label: 'Done' },
];

// Relative "time ago" — compact (5h, 2d), absolute past a month.
function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const authorInitial = (name) => (name || 'F').trim()[0]?.toUpperCase() || 'F';
const displayName = (c) => c.authorName || 'Facebook user';

function UserGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function VerifiedBadge() {
  return (
    <svg className="cfb__verified" viewBox="0 0 24 24" width="14" height="14" fill="#1b74e4" aria-hidden="true">
      <path d="M12 2l2.4 1.8 3 .1 1 2.8 2.4 1.7-.9 2.9.9 2.9-2.4 1.7-1 2.8-3 .1L12 22l-2.4-1.8-3-.1-1-2.8L3.2 15.6l.9-2.9-.9-2.9 2.4-1.7 1-2.8 3-.1L12 2z" />
      <polyline points="8.5 12.2 11 14.6 15.6 9.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MessageGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

// Post thumbnail (or a caption/text placeholder) for a list row.
function RowThumb({ post }) {
  if (post?.thumbnailUrl) return <img className="cinbox__thumb" src={post.thumbnailUrl} alt="" loading="lazy" />;
  return (
    <span className="cinbox__thumb cinbox__thumb--empty" aria-hidden="true">
      {post?.mediaType === 'video' ? '🎬' : '📝'}
    </span>
  );
}

export default function CommentsInboxPage() {
  const { activePage } = usePages();
  const toast = useToast();
  const navigate = useNavigate();
  const pageId = activePage?.id ?? 'none';
  const pageName = activePage?.account_name || 'Your Page';

  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  // Optimistic handled overrides ({ [commentId]: 'done' | 'open' }) so marking a comment
  // updates instantly without re-pulling the whole (live) feed.
  const [overrides, setOverrides] = useState({});
  // Replies we posted this session — Facebook won't echo them back into the feed.
  const [sentReplies, setSentReplies] = useState({}); // { [commentId]: [{ id, message }] }
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [dockedChat, setDockedChat] = useState(null); // { postId, commentId, prefill }
  const [sessionMessaged, setSessionMessaged] = useState({}); // { [commentId]: conversationId }
  // Full post (playable media + engagement counts) lazy-loaded per post on selection,
  // so the detail pane renders a real Facebook-style post. { [postId]: post|'loading'|'error' }
  const [postDetails, setPostDetails] = useState({});
  // Live comments that arrived over SSE since the last full feed pull (merged into the
  // list ahead of the fetched feed; deduped against it so a Refresh doesn't double them).
  const [live, setLive] = useState({ comments: [], posts: {} });
  const composerRef = useRef(null);

  // Always pull the full feed (server returns handled flags); filter client-side so tab
  // switches are instant and don't re-hit Facebook. Keyed by page → re-pulls on page switch.
  const { data, loading, error, refresh } = useCachedResource(`comments-feed:${pageId}`, () =>
    postPool.commentFeed({ filter: 'all' }),
  );

  useEffect(() => {
    if (error) toast.error(apiError(error));
  }, [error, toast]);

  // Reset transient per-page state when the active page changes.
  useEffect(() => {
    setOverrides({});
    setSentReplies({});
    setSessionMessaged({});
    setSelectedId(null);
    setLive({ comments: [], posts: {} });
  }, [pageId]);

  // Live comments over SSE: insert new/edited comments for the active page at the top,
  // drop removed ones. Deduped against the fetched feed when merged into `rows` below.
  useEffect(() => {
    const unsubscribe = subscribeComments((ev) => {
      if (!ev || ev.accountId == null || activePage?.id == null) return;
      if (Number(ev.accountId) !== Number(activePage.id)) return; // another page — ignore
      if (ev.type === 'comment:removed') {
        setLive((prev) => ({ ...prev, comments: prev.comments.filter((c) => c.id !== ev.commentId) }));
        return;
      }
      if ((ev.type === 'comment:new' || ev.type === 'comment:edited') && ev.comment) {
        setLive((prev) => {
          const without = prev.comments.filter((c) => c.id !== ev.comment.id);
          return {
            comments: [ev.comment, ...without],
            posts: ev.post ? { ...prev.posts, [ev.post.id]: ev.post } : prev.posts,
          };
        });
      }
    });
    return unsubscribe;
  }, [activePage?.id]);

  const posts = { ...(data?.posts || {}), ...live.posts };

  const rows = useMemo(() => {
    const base = data?.comments || [];
    const baseIds = new Set(base.map((c) => c.id));
    // Live comments first (newest), then the fetched feed; dedupe so a refresh (which
    // re-pulls them from Facebook) never shows a comment twice.
    const merged = [...live.comments.filter((c) => !baseIds.has(c.id)), ...base];
    return merged
      .map((c) => ({ ...c, handled: overrides[c.id] != null ? overrides[c.id] === 'done' : c.handled }))
      .filter((c) => (filter === 'open' ? !c.handled : filter === 'done' ? c.handled : true))
      .sort((a, b) => new Date(b.created_time) - new Date(a.created_time));
  }, [data, live, overrides, filter]);

  // Keep a valid selection: default to the first row, re-point if the current selection
  // was filtered out (e.g. just marked done under "Unhandled").
  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!rows.some((c) => c.id === selectedId)) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const selected = rows.find((c) => c.id === selectedId) || null;
  const selectedPost = selected ? posts[selected.postId] : null;
  const fullPost = selected ? postDetails[selected.postId] : null;
  const postLoaded = fullPost && fullPost !== 'loading' && fullPost !== 'error';

  useEffect(() => {
    setReplyText('');
    setReplyError(null);
  }, [selectedId]);

  // Lazy-load the selected comment's full post (playable media + counts), once per post.
  useEffect(() => {
    const pid = selected?.postId;
    if (pid == null || postDetails[pid]) return undefined;
    let cancelled = false;
    setPostDetails((m) => ({ ...m, [pid]: 'loading' }));
    postPool
      .get(pid)
      .then((full) => {
        if (!cancelled) setPostDetails((m) => ({ ...m, [pid]: full }));
      })
      .catch(() => {
        if (!cancelled) setPostDetails((m) => ({ ...m, [pid]: 'error' }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.postId]);

  const setStatus = async (comment, status) => {
    if (!comment || statusBusy) return;
    setStatusBusy(true);
    setOverrides((prev) => ({ ...prev, [comment.id]: status })); // optimistic
    try {
      await postPool.setCommentStatus(comment.id, { postId: comment.postId, status });
    } catch (e) {
      setOverrides((prev) => ({ ...prev, [comment.id]: status === 'done' ? 'open' : 'done' })); // revert
      toast.error(apiError(e));
    } finally {
      setStatusBusy(false);
    }
  };

  const submitReply = async () => {
    const body = replyText.trim();
    if (!body || !selected || replyBusy) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const { id } = await postPool.replyToComment(selected.postId, selected.id, body);
      setSentReplies((prev) => ({
        ...prev,
        [selected.id]: [...(prev[selected.id] || []), { id: id || `local-${(prev[selected.id] || []).length}`, message: body }],
      }));
      setReplyText('');
      if (!selected.handled) setStatus(selected, 'done'); // replying handles the comment
      toast.success('Reply posted');
    } catch (e) {
      setReplyError(apiError(e));
    } finally {
      setReplyBusy(false);
    }
  };

  const openMessageCommenter = (comment) =>
    setDockedChat({ postId: comment.postId, commentId: comment.id, prefill: activePage?.comment_dm_default_message || '' });

  const openConversation = (conversationId) => {
    if (!conversationId) return;
    const page = activePage?.id != null ? `&page=${activePage.id}` : '';
    navigate(`/messages?c=${conversationId}${page}`);
  };

  const totalCount = (data?.comments || []).length;
  const messaged = selected && (selected.conversationId || sessionMessaged[selected.id]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Comments</h1>
          <div className="page-head__sub">Replies from across your posts, newest first — reply and mark them handled.</div>
        </div>
        <Button variant="ghost" onClick={refresh} disabled={loading}>
          ↻ Refresh
        </Button>
      </div>

      {loading && totalCount === 0 ? (
        <Spinner label="Loading comments…" />
      ) : !activePage ? (
        <Card>
          <EmptyState icon="💬" title="No page selected" message="Pick an active page to see its comments." />
        </Card>
      ) : (
        <div className="cinbox">
          {/* Left: filter tabs + flat, newest-first comment list */}
          <Card className="cinbox__list-card">
            <div className="cinbox__list-head" role="tablist" aria-label="Filter comments">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  className={`cinbox__tab${filter === f.key ? ' is-active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="cinbox__list">
              {rows.length === 0 ? (
                <div className="cinbox__list-empty">
                  {filter === 'all'
                    ? 'No comments on your recent posts yet.'
                    : filter === 'open'
                      ? 'All caught up — nothing unread. 🎉'
                      : "You haven't marked any comments done yet."}
                </div>
              ) : (
                rows.map((c) => {
                  const post = posts[c.postId];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`cinbox__row${c.id === selectedId ? ' is-active' : ''}${c.handled ? ' is-handled' : ''}`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <RowThumb post={post} />
                      <span className="cinbox__row-main">
                        <span className="cinbox__row-top">
                          <span className="cinbox__row-caption">
                            {post?.caption ? post.caption : <em className="text-muted">Your post</em>}
                          </span>
                          <span className="cinbox__row-time">{timeAgo(c.created_time)}</span>
                        </span>
                        <span className="cinbox__row-comment">
                          <span className="cinbox__row-commenter">{displayName(c)}:</span>{' '}
                          {c.message || <em className="text-muted">(no text)</em>}
                        </span>
                      </span>
                      {c.handled && (
                        <span className="cinbox__row-done" title="Handled" aria-label="Handled">
                          <CheckGlyph />
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
            {data?.truncated && rows.length > 0 && (
              <div className="cinbox__note">Showing comments from your {data.scannedPosts} most recent posts.</div>
            )}
          </Card>

          {/* Right: framed panel — top bar + centered post card + bottom composer */}
          <Card className="cinbox__detail-card">
            {!selected ? (
              <div className="cinbox__detail-empty">Select a comment to reply.</div>
            ) : (
              <>
                {/* Top bar — post summary + counts + mark-done */}
                <div className="cinbox__detail-bar">
                  <div className="cinbox__detail-bar-main">
                    <div className="cinbox__detail-bar-title">
                      {selectedPost?.caption ? selectedPost.caption : 'Published post'}
                    </div>
                    <div className="cinbox__detail-bar-meta">
                      {postLoaded ? `${fullPost.reactions_count ?? 0} reactions · ${fullPost.comments_count ?? 0} comments` : `${selectedPost?.comments_count ?? 0} comments`}
                      {selectedPost?.postedAt ? ` · ${timeAgo(selectedPost.postedAt)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`cinbox__detail-bar-btn${selected.handled ? ' is-done' : ''}`}
                    onClick={() => setStatus(selected, selected.handled ? 'open' : 'done')}
                    disabled={statusBusy}
                    title={selected.handled ? 'Reopen this comment' : 'Mark this comment done'}
                  >
                    <CheckGlyph /> {selected.handled ? 'Done' : 'Mark done'}
                  </button>
                </div>

                {/* Scrollable body — the post card centered on a recessed background */}
                <div className="cinbox__detail-scroll">
                  <div className="cfb">
                    {/* Post header */}
                    <div className="cfb__head">
                      <PageAvatar page={activePage} className="cfb__page-av" />
                      <div className="cfb__head-id">
                        <span className="cfb__page-name">
                          {pageName}
                          <VerifiedBadge />
                        </span>
                        <span className="cfb__head-sub">
                          {selectedPost?.postedAt ? `${timeAgo(selectedPost.postedAt)} · ` : ''}Published post
                        </span>
                      </div>
                    </div>

                    {/* Caption */}
                    {selectedPost?.caption && (
                      <div className="cfb__caption">
                        <Linkify text={selectedPost.caption} />
                      </div>
                    )}

                    {/* Media stage — plays the real video letterboxed on black, like Facebook */}
                    {(postLoaded ? fullPost.media_preview_url : selectedPost?.thumbnailUrl) && (
                      <div className="cfb__stage">
                        {postLoaded && fullPost.media_preview_url ? (
                          fullPost.media_type === 'video' ? (
                            <video
                              key={fullPost.id}
                              src={fullPost.media_preview_url}
                              poster={fullPost.thumbnail_preview_url || selectedPost?.thumbnailUrl || undefined}
                              controls
                              preload="none"
                            />
                          ) : (
                            <img src={fullPost.media_preview_url} alt="" />
                          )
                        ) : (
                          <img src={selectedPost?.thumbnailUrl} alt="" /> // feed thumbnail while the full post loads
                        )}
                      </div>
                    )}

                    {/* Engagement bar — reactions · comments · shares */}
                    <div className="cfb__engage">
                      <span className="cfb__eng" title="Reactions">
                        <HeartIcon size={17} /> {postLoaded ? fullPost.reactions_count ?? 0 : 0}
                      </span>
                      <span className="cfb__eng" title="Comments">
                        <CommentIcon size={17} /> {postLoaded ? fullPost.comments_count ?? 0 : selectedPost?.comments_count ?? 0}
                      </span>
                      <span className="cfb__eng" title="Shares">
                        <ShareIcon size={17} /> {postLoaded ? fullPost.shares_count ?? 0 : 0}
                      </span>
                    </div>
                    <div className="cfb__rule" />

                    {/* Thread — the selected comment as an FB bubble + our replies */}
                    <div className="cfb__thread">
                      <div className="cfb__c">
                        <span className="cfb__av" aria-hidden="true">
                          {selected.authorName ? authorInitial(selected.authorName) : <UserGlyph />}
                        </span>
                        <div className="cfb__c-body">
                          <div className="cfb__bubble">
                            <span className="cfb__c-name">{displayName(selected)}</span>
                            <span className="cfb__c-text">{selected.message || <em className="text-muted">(no text)</em>}</span>
                          </div>
                          <div className="cfb__c-actions">
                            <span className="cfb__c-time">{timeAgo(selected.created_time)}</span>
                            <button type="button" className="cfb__c-link" onClick={() => composerRef.current?.focus()}>
                              Reply
                            </button>
                            {messaged ? (
                              <button type="button" className="cfb__c-link is-done" onClick={() => openConversation(selected.conversationId || sessionMessaged[selected.id])}>
                                <MessageGlyph /> Messaged
                              </button>
                            ) : (
                              <button type="button" className="cfb__c-link" onClick={() => openMessageCommenter(selected)}>
                                <MessageGlyph /> Message
                              </button>
                            )}
                          </div>

                          {(sentReplies[selected.id] || []).map((r) => (
                            <div className="cfb__c cfb__c--reply" key={r.id}>
                              <PageAvatar page={activePage} className="cfb__av cfb__av--img" />
                              <div className="cfb__c-body">
                                <div className="cfb__bubble cfb__bubble--page">
                                  <span className="cfb__c-name">
                                    {pageName}
                                    <span className="cfb__author-tag">Author</span>
                                  </span>
                                  <span className="cfb__c-text">{r.message}</span>
                                </div>
                                <div className="cfb__c-actions">
                                  <span className="cfb__c-time">just now</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Composer bar — spans the pane bottom, "Reply as [Page]" */}
                <div className="cinbox__composer-bar">
                  <PageAvatar page={activePage} className="cfb__av cfb__av--img" />
                  <div className="cinbox__composer-field">
                    <textarea
                      ref={composerRef}
                      className="cfb__composer-input"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Reply as ${pageName}…`}
                      rows={1}
                      disabled={replyBusy}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          submitReply();
                        }
                      }}
                    />
                    {replyError && <div className="post-comments__status post-comments__status--error">{replyError}</div>}
                  </div>
                  <Button className="btn--flat cinbox__composer-send" onClick={submitReply} disabled={replyBusy || !replyText.trim()}>
                    {replyBusy ? 'Sending…' : 'Reply'}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <DockedChat
        chat={dockedChat}
        onClose={() => setDockedChat(null)}
        onOpened={(commentId, cid) => setSessionMessaged((m) => ({ ...m, [commentId]: cid }))}
      />
    </>
  );
}
