import { query } from '../config/db.js';
import { createDownloadUrl } from './s3.service.js';
import { emitCommentEvent } from './comment_events.js';

// Light per-post descriptor for a live comment row — mirrors the shape
// listCommentFeed returns in post_pool.service.js (posts map), so the client can
// render the new row identically.
async function postDescriptor(post) {
  let thumbnailUrl = null;
  if (post.thumbnail_s3_key) {
    try {
      thumbnailUrl = await createDownloadUrl(post.thumbnail_s3_key);
    } catch {
      /* S3 not configured / object missing */
    }
  }
  return {
    id: post.id,
    caption: post.caption,
    mediaType: post.media_type,
    thumbnailUrl,
    comments_count: post.comments_count,
    postedAt: post.posted_at,
  };
}

/**
 * Handle Facebook `feed` webhook events (Page object) and push comment changes to the
 * Comments inbox over SSE. The webhook delivers each change under entry[].changes[]
 * with field:'feed' and value.item:'comment' (verb: add | edited | remove).
 *
 * Best-effort throughout: an unknown page/post, or a comment authored by the page
 * itself (our own reply), is skipped; nothing here ever throws to the webhook handler.
 */
export async function handleFeedEvent(body = {}) {
  if (!body || body.object !== 'page') return;
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const pageId = String(entry.id || '');
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    let account = null;
    for (const change of changes) {
      if (change.field !== 'feed') continue;
      const v = change.value || {};
      if (v.item !== 'comment') continue;

      // Resolve the connected page once (by fb_page_id). If it isn't ours, ignore the entry.
      if (!account) {
        const rows = await query('SELECT id FROM platform_accounts WHERE fb_page_id = ? LIMIT 1', [pageId]);
        if (!rows.length) break;
        account = rows[0];
      }
      // Ignore the page's own comments/replies (outbound) — don't echo our own replies.
      if (v.from && String(v.from.id) === pageId) continue;

      // Map the comment's post_id ({page}_{post}) to a tracked post row.
      const postId = String(v.post_id || '');
      const postRows = await query(
        'SELECT * FROM post_pool WHERE account_id = ? AND (parent_post_id = ? OR platform_post_id = ?) LIMIT 1',
        [account.id, postId, postId],
      );
      if (!postRows.length) continue; // a comment on a post we don't track — skip
      const post = postRows[0];

      const commentId = String(v.comment_id || '');
      if (!commentId) continue;

      if (v.verb === 'remove') {
        emitCommentEvent({ type: 'comment:removed', accountId: account.id, commentId });
        continue;
      }
      if (v.verb !== 'add' && v.verb !== 'edited') continue;

      const comment = {
        id: commentId,
        postId: post.id,
        message: v.message || '',
        // Feed webhooks stamp created_time as unix seconds; fall back to now.
        created_time: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : new Date().toISOString(),
        authorName: v.from?.name || null,
        handled: false,
        handledBy: null,
        handledAt: null,
        conversationId: null,
      };

      emitCommentEvent({
        type: v.verb === 'edited' ? 'comment:edited' : 'comment:new',
        accountId: account.id,
        postId: post.id,
        comment,
        post: await postDescriptor(post),
      });
    }
  }
}
