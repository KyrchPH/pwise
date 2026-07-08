import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/post_pool.service.js';
import * as settings from '../services/settings.service.js';
import { onCommentEvent } from '../services/comment_events.js';
import { resolveSession } from '../services/auth.service.js';
import { canUseModule } from '../config/modules.js';

// SSE stream of live Facebook comments for the Comments inbox. EventSource can't set an
// Authorization header, so the JWT is passed as ?token=. Gated on Contents (post-pool)
// access — NOT messaging. Events are broadcast; the client keeps only its active page's.
export async function commentStream(req, res) {
  let user = null;
  try {
    const token = req.query.token;
    if (token) {
      const r = await resolveSession(token);
      user = r ? r.user : null;
    }
  } catch {
    user = null;
  }
  if (!user) {
    res.status(401).json({ success: false, message: 'unauthorized' });
    return;
  }
  if (!canUseModule(user, 'post-pool')) {
    res.status(403).json({ success: false, message: 'forbidden' });
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  res.write(': connected\n\n');

  const unsubscribe = onCommentEvent((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

// Shared pool: reads are not user-scoped (everyone sees every post). Writes pass
// the acting user (req.user = { id, name, ... }) so the action is audit-logged.
export const list = asyncHandler(async (req, res) => {
  const { status, scheduled, limit, offset, refresh, from, to, all_pages: allPages } = req.query;
  const accountId = await settings.getSelectedAccountId(req.user.id); // active page scope
  // The Content Calendar is a GENERAL view and passes all_pages=1 to see every
  // page's scheduled posts (each tagged with its page for the logo).
  const { posts, total } = await service.list({ status, scheduled, accountId, allPages, from, to, limit, offset });
  // `refresh=1` re-reads engagement for this page's published posts from Facebook
  // (stale-only, best-effort) before responding — used by the Post Pool page load.
  if (refresh === '1' || refresh === 'true') await service.refreshEngagement(posts);
  sendSuccess(res, { posts, total });
});

export const create = asyncHandler(async (req, res) => {
  const post = await service.create(req.user, req.body || {});
  sendSuccess(res, { post }, 201);
});

export const get = asyncHandler(async (req, res) => {
  let post = await service.getById(req.params.id);
  // ?refresh=1 → force a live engagement pull (bypassing the 5-min TTL) so the post
  // viewer's counts match its live comments. Best-effort: refreshEngagement leaves the
  // cached counts in place if Facebook is unreachable.
  if ((req.query.refresh === '1' || req.query.refresh === 'true') && post.status === 'posted' && post.platform_post_id) {
    [post] = await service.refreshEngagement([post], { force: true });
  }
  // Presign the (private) S3 media so the client gets media_preview_url /
  // thumbnail_preview_url, same as the list rows.
  post = await service.withMediaPreview(post);
  sendSuccess(res, { post });
});

export const comments = asyncHandler(async (req, res) => {
  const result = await service.listComments(req.params.id, {
    after: req.query.after,
    limit: req.query.limit,
  });
  sendSuccess(res, result);
});

// Comments inbox: a flat, newest-first feed of live Facebook comments across the
// active page's published posts, with team-shared "handled" state.
export const commentFeed = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id); // active page scope
  const result = await service.listCommentFeed({ accountId, filter: req.query.filter });
  sendSuccess(res, result);
});

// Mark a comment handled/open (shared across the team on that page).
export const setCommentStatus = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id);
  const result = await service.setCommentStatus({
    accountId,
    postId: req.body?.postId,
    commentId: req.params.commentId,
    status: req.body?.status,
    actor: req.user,
  });
  sendSuccess(res, result);
});

// Reply to a Facebook comment as the page (from the post view).
export const replyComment = asyncHandler(async (req, res) => {
  const result = await service.replyToComment(req.params.id, req.params.commentId, req.body?.message);
  sendSuccess(res, result, 201);
});

// Message the person who left a comment — private reply, then open the conversation.
export const messageCommenter = asyncHandler(async (req, res) => {
  const result = await service.messageCommenter(
    req.params.id,
    req.params.commentId,
    { message: req.body?.message },
    req.user,
  );
  sendSuccess(res, result, 201);
});

export const insights = asyncHandler(async (req, res) => {
  const result = await service.insights(req.params.id, {
    metric: req.query.metric,
    granularity: req.query.granularity,
  });
  sendSuccess(res, result);
});

export const update = asyncHandler(async (req, res) => {
  const post = await service.update(req.params.id, req.body || {}, req.user);
  sendSuccess(res, { post });
});

// Retry a failed/expired post immediately (re-publish via the n8n webhook, ignoring
// the schedule). Returns the post flipped to 'posting'.
export const retry = asyncHandler(async (req, res) => {
  const post = await service.retryNow(req.params.id, req.user);
  sendSuccess(res, { post });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.params.id, req.user);
  sendSuccess(res, result);
});

export const counts = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id); // active page scope
  const counts = await service.counts(accountId);
  sendSuccess(res, { counts });
});

// Pre-flight check the client calls before uploading media to a scheduled slot.
export const checkSlot = asyncHandler(async (req, res) => {
  const available = await service.isSlotFree(req.query.scheduled_at, req.query.exclude_id);
  sendSuccess(res, { available });
});
