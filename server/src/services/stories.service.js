import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl, deleteObject } from './s3.service.js';
import * as fb from './fb.service.js';
import * as accounts from './platform_accounts.service.js';
import * as activity from './activity.service.js';

// 24-hour Stories published to Facebook / Instagram (Contents → Stories).
// One row per destination platform. Publishing runs in the BACKGROUND: create()
// inserts 'posting' rows and returns immediately; each row flips to posted/failed
// when its Graph flow completes (the client re-polls while any row is posting).
// Like the post pool, the list is shared — user_id records the creator (audit).

const ALLOWED_PLATFORMS = ['facebook', 'instagram'];
const ALLOWED_MEDIA = ['image', 'video'];
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

// Presigned GET URLs so the UI can render the (private) S3 media.
async function withMediaPreview(story) {
  const out = { ...story, media_preview_url: null, thumbnail_preview_url: null };
  if (story.s3_key) {
    try {
      out.media_preview_url = await createDownloadUrl(story.s3_key);
    } catch {
      /* S3 not configured / object missing */
    }
  }
  if (story.thumbnail_s3_key) {
    try {
      out.thumbnail_preview_url = await createDownloadUrl(story.thumbnail_s3_key);
    } catch {
      /* S3 not configured / object missing */
    }
  }
  return out;
}

export async function getById(id) {
  const rows = await query('SELECT * FROM page_stories WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('story not found');
  return rows[0];
}

// Page-scoped, newest first. Returns { stories, total } with presigned previews.
export async function list({ accountId, limit = 30, offset = 0 } = {}) {
  if (accountId == null) return { stories: [], total: 0 };
  const lim = Math.min(Math.max(Math.trunc(Number(limit) || 30), 1), 100);
  const off = Math.max(Math.trunc(Number(offset) || 0), 0);
  const rows = await query(
    'SELECT * FROM page_stories WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [accountId, lim, off],
  );
  const countRows = await query('SELECT COUNT(*) AS total FROM page_stories WHERE account_id = ?', [accountId]);
  return {
    stories: await Promise.all(rows.map(withMediaPreview)),
    total: Number(countRows[0]?.total) || 0,
  };
}

// Run one story row's Graph publish flow and record the outcome. Fire-and-forget
// from create()/retryNow() — never throws (a failure lands in failed_reason).
async function publishStory(id) {
  let story;
  try {
    story = await getById(id);
    const page = await accounts.getDecrypted(story.account_id);
    // A long-lived presigned URL: Meta downloads the media itself, and video
    // processing can outlive the default TTL.
    const mediaUrl = await createDownloadUrl(story.s3_key, 60 * 60);

    let result;
    if (story.platform === 'instagram') {
      result = await fb.publishInstagramStory({
        igUserId: page.instagram_account_id,
        mediaType: story.media_type,
        mediaUrl,
        token: page.access_token,
      });
    } else if (story.media_type === 'video') {
      result = await fb.publishVideoStory({ videoUrl: mediaUrl, token: page.access_token, fbPageId: page.fb_page_id });
    } else {
      result = await fb.publishPhotoStory({ photoUrl: mediaUrl, token: page.access_token, fbPageId: page.fb_page_id });
    }

    await query(
      `UPDATE page_stories
       SET status = 'posted', platform_story_id = ?, failed_reason = NULL,
           posted_at = UTC_TIMESTAMP(), expires_at = UTC_TIMESTAMP() + INTERVAL 24 HOUR
       WHERE id = ?`,
      [result.storyId, id],
    );
  } catch (err) {
    const reason = String(err?.message || err).slice(0, 1000);
    try {
      await query("UPDATE page_stories SET status = 'failed', failed_reason = ? WHERE id = ?", [reason, id]);
    } catch (dbErr) {
      console.error(`[stories] couldn't record failure for story #${id}: ${dbErr.message}`);
    }
    console.warn(`[stories] publish failed for story #${id} (${story?.platform || '?'}): ${reason}`);
  }
}

// Create one story row per requested platform and start publishing them in the
// background. `actor` = { id, name } of the signed-in creator (audit).
export async function create(actor = {}, { accountId, s3_key = null, thumbnail_s3_key = null, media_type = null, platforms = [] } = {}) {
  if (accountId == null) throw ApiError.badRequest('select a page before posting a story');
  if (!s3_key) throw ApiError.badRequest('story media is required');
  if (!ALLOWED_MEDIA.includes(media_type)) throw ApiError.badRequest('media_type must be image or video');

  const targets = [...new Set(Array.isArray(platforms) ? platforms : [platforms])].filter(Boolean);
  if (!targets.length) throw ApiError.badRequest('pick at least one platform (facebook, instagram)');
  for (const p of targets) {
    if (!ALLOWED_PLATFORMS.includes(p)) throw ApiError.badRequest(`invalid platform: ${p}`);
  }
  if (targets.includes('instagram')) {
    const page = await accounts.getById(accountId);
    if (!page.instagram_account_id) {
      throw ApiError.badRequest('this page has no linked Instagram account — connect one in Settings first');
    }
  }

  const ids = [];
  for (const platform of targets) {
    const result = await query(
      `INSERT INTO page_stories (user_id, account_id, platform, media_type, s3_key, thumbnail_s3_key, status)
       VALUES (?, ?, ?, ?, ?, ?, 'posting')`,
      [actor.id ?? null, accountId, platform, media_type, s3_key, thumbnail_s3_key],
    );
    ids.push(result.insertId);
  }
  await activity.log({
    userId: actor.id,
    userName: actor.name,
    action: 'created',
    details: `story (${media_type}) → ${targets.join(', ')}`,
  });

  // Background publish — deliberately not awaited (one slow video must not hold
  // the HTTP response). publishStory never throws.
  for (const id of ids) publishStory(id);

  const rows = await query(
    `SELECT * FROM page_stories WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ids,
  );
  return Promise.all(rows.map(withMediaPreview));
}

// Re-run a failed story's publish flow. Flips it back to 'posting' up front so a
// double-click can't double-publish.
export async function retryNow(id, actor = {}) {
  const story = await getById(id);
  if (story.status !== 'failed') {
    throw ApiError.badRequest(`only failed stories can be retried (this one is '${story.status}')`);
  }
  await query("UPDATE page_stories SET status = 'posting', failed_reason = NULL WHERE id = ?", [id]);
  publishStory(id); // background; never throws
  await activity.log({
    userId: actor.id,
    userName: actor.name,
    action: 'edited',
    details: `story #${id} retried (${story.platform})`,
  });
  return withMediaPreview(await getById(id));
}

// Delete a story record. Best-effort on the platform side: a live Facebook story
// is deleted on Facebook too; Instagram doesn't support API deletion (the story
// expires within 24h regardless). The S3 media is only removed when no OTHER
// story row still references the same object (both-platform publishes share it).
export async function remove(id, actor = {}) {
  const story = await getById(id);

  if (story.platform === 'facebook' && story.status === 'posted' && story.platform_story_id) {
    // expires_at comes back as a JS Date (mysql2 timezone:'Z'), so compare directly.
    const notExpired = story.expires_at && new Date(story.expires_at).getTime() > Date.now();
    if (notExpired) {
      try {
        const page = await accounts.getDecrypted(story.account_id);
        await fb.deleteStory(story.platform_story_id, page.access_token); // best-effort
      } catch {
        /* page gone / decryption unavailable — still delete the local record */
      }
    }
  }

  await query('DELETE FROM page_stories WHERE id = ?', [id]);
  for (const key of [story.s3_key, story.thumbnail_s3_key]) {
    if (!key) continue;
    const still = await query('SELECT id FROM page_stories WHERE s3_key = ? OR thumbnail_s3_key = ? LIMIT 1', [key, key]);
    if (!still.length) await deleteObject(key); // best-effort; never throws
  }
  await activity.log({
    userId: actor.id,
    userName: actor.name,
    action: 'deleted',
    details: `story #${id} (${story.platform})`,
  });
  return { id: Number(id), deleted: true };
}
