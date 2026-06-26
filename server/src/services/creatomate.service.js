import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl, putObject } from './s3.service.js';

const MAX_LEN = 20000;
const COLS = 'id, name, config, user_id, created_at, updated_at';

function normalizeName(value) {
  const n = String(value ?? '').trim();
  if (!n) throw ApiError.badRequest('template name is required');
  if (n.length > 255) throw ApiError.badRequest('name is too long (max 255 characters)');
  return n;
}

// Validate the config is a JSON object; return it pretty-printed (canonical).
function normalizeConfig(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw ApiError.badRequest('template JSON is required');
  if (raw.length > MAX_LEN) throw ApiError.badRequest(`template JSON is too long (max ${MAX_LEN} characters)`);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw ApiError.badRequest('template JSON is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ApiError.badRequest('template JSON must be a JSON object');
  }
  return JSON.stringify(parsed, null, 2);
}

export async function list() {
  return query(`SELECT ${COLS} FROM creatomate_templates ORDER BY created_at DESC`);
}

export async function getById(id) {
  const rows = await query(`SELECT ${COLS} FROM creatomate_templates WHERE id = ?`, [id]);
  if (!rows.length) throw ApiError.notFound('template not found');
  return rows[0];
}

// `actor` = { id, name } of the signed-in user (recorded as the creator).
export async function create(actor = {}, { name, config } = {}) {
  const n = normalizeName(name);
  const c = normalizeConfig(config);
  const result = await query('INSERT INTO creatomate_templates (name, config, user_id) VALUES (?, ?, ?)', [
    n,
    c,
    actor.id ?? null,
  ]);
  return getById(result.insertId);
}

export async function update(id, { name, config } = {}) {
  await getById(id); // existence check
  const fields = [];
  const params = [];
  if (name !== undefined) {
    fields.push('name = ?');
    params.push(normalizeName(name));
  }
  if (config !== undefined) {
    fields.push('config = ?');
    params.push(normalizeConfig(config));
  }
  if (fields.length) {
    params.push(id);
    await query(`UPDATE creatomate_templates SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  return getById(id);
}

export async function remove(id) {
  const result = await query('DELETE FROM creatomate_templates WHERE id = ?', [id]);
  if (!result.affectedRows) throw ApiError.notFound('template not found');
  return { id: Number(id), deleted: true };
}

// ── "Generate with Template" — rendering delegated to n8n ────────────────────
// The server does NOT call Creatomate directly. It uploads the input video to
// S3, then triggers the n8n "Post to n8n" webhook, which runs the Creatomate
// render (n8n holds the Creatomate credential) and responds with the output URL.

function ensureWebhook() {
  if (!env.n8n.generateWebhookUrl) {
    throw new ApiError(503, 'Template rendering is disabled: N8N_GENERATE_WEBHOOK_URL is not configured on the server');
  }
}

function parseStoredConfig(raw) {
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    throw ApiError.badRequest('template config is not valid JSON');
  }
  if (!cfg || typeof cfg !== 'object' || !cfg.template_id) {
    throw ApiError.badRequest('template config is missing a "template_id"');
  }
  return cfg;
}

// Basic SSRF guard before the server fetches a URL handed in by the client.
function assertFetchableUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw ApiError.badRequest('invalid video URL');
  }
  if (u.protocol !== 'https:') throw ApiError.badRequest('video URL must be https');
  const host = u.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) throw ApiError.badRequest('refusing to fetch a private/loopback URL');
  return u.toString();
}

/**
 * Kick off an ASYNC render: create a render-job row, fire the n8n webhook (which
 * starts the Creatomate render and returns right away — no poll loop), and hand back
 * the job id immediately. The render finishes later and Creatomate → n8n calls our
 * /renders/callback (see recordRenderResult). The job id rides `render_job_id` →
 * Creatomate `metadata` → the callback, so the result correlates back to this job.
 */
export async function startRender(actor, templateDbId, { videoS3Key = null, imageS3Key = null, text = null, caption = null } = {}) {
  ensureWebhook();
  const tpl = await getById(templateDbId); // 404s if the template is gone
  const cfg = parseStoredConfig(tpl.config);

  // Inject the input video, the in-video image, and the in-video text into the
  // template's elements (keys configured in env.creatomate). Each is optional — only
  // set the modification when a value was provided.
  const videoUrl = videoS3Key ? await createDownloadUrl(videoS3Key) : null;
  const imageUrl = imageS3Key ? await createDownloadUrl(imageS3Key) : null;
  const cleanText = typeof text === 'string' ? text.trim() : '';
  const modifications = { ...(cfg.modifications || {}) };
  if (videoUrl) modifications[env.creatomate.videoKey] = videoUrl;
  if (imageUrl) modifications[env.creatomate.imageKey] = imageUrl;
  if (cleanText) modifications[env.creatomate.textKey] = cleanText;

  const renderJobId = crypto.randomUUID();
  await query('INSERT INTO creatomate_renders (id, user_id, template_id, status) VALUES (?, ?, ?, ?)', [
    renderJobId,
    actor?.id ?? null,
    templateDbId,
    'rendering',
  ]);

  const headers = { 'Content-Type': 'application/json' };
  if (env.n8n.webhookToken) headers['x-service-token'] = env.n8n.webhookToken;

  // The input clip stays in S3 under tmp/; an S3 lifecycle rule on tmp/ expires it.
  // We only wait for the quick "start render" round-trip (n8n creates the Creatomate
  // render and responds), NOT the whole render.
  try {
    const res = await fetch(env.n8n.generateWebhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        for_automation: true, // routes n8n's "Is For Automated Editing?" IF to the render branch
        template_id: cfg.template_id,
        video_url: videoUrl,
        image_url: imageUrl, // informational — the value is also in `modifications`
        caption,
        page_id: env.facebook.pageId || null,
        modifications,
        render_job_id: renderJobId, // → Creatomate `metadata` → echoed to the callback
        render_complete_url: env.n8n.renderCompleteWebhookUrl || null, // → Creatomate `webhook_url`
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      await markRenderFailed(renderJobId, `n8n render webhook error: ${body?.message || res.statusText}`);
      throw new ApiError(res.status, `n8n render webhook error: ${body?.message || res.statusText}`);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    await markRenderFailed(renderJobId, err.message).catch(() => {});
    if (err?.name === 'TimeoutError') throw new ApiError(504, 'could not start the render — n8n did not respond in time');
    throw new ApiError(502, `couldn't reach the n8n render webhook: ${err.message}`);
  }

  return { renderJobId, status: 'rendering' };
}

async function markRenderFailed(renderJobId, message) {
  await query('UPDATE creatomate_renders SET status = ?, error_message = ? WHERE id = ?', [
    'failed',
    message ? String(message).slice(0, 2000) : null,
    renderJobId,
  ]);
}

/**
 * Record a finished render — called by the n8n render-complete webhook through the
 * service-token callback. Correlated to the job via render_job_id.
 */
export async function recordRenderResult(renderJobId, { status, videoUrl = null, snapshotUrl = null, errorMessage = null } = {}) {
  const id = String(renderJobId || '').trim();
  if (!id) throw ApiError.badRequest('render_job_id is required');
  const finalStatus = status === 'succeeded' ? 'succeeded' : 'failed';
  const result = await query(
    'UPDATE creatomate_renders SET status = ?, video_url = ?, snapshot_url = ?, error_message = ? WHERE id = ?',
    [finalStatus, videoUrl || null, snapshotUrl || null, errorMessage ? String(errorMessage).slice(0, 2000) : null, id],
  );
  if (!result.affectedRows) throw ApiError.notFound('render job not found');
  return { renderJobId: id, status: finalStatus };
}

/**
 * Current state of a render job — the composer polls this until succeeded/failed.
 * Scoped to the owner so one user can't read another's render.
 */
export async function getRenderJob(jobId, actor = {}) {
  const id = String(jobId || '').trim();
  const rows = await query(
    'SELECT id, user_id, status, video_url, snapshot_url, error_message FROM creatomate_renders WHERE id = ?',
    [id],
  );
  if (!rows.length) throw ApiError.notFound('render job not found');
  const r = rows[0];
  if (r.user_id != null && actor?.id != null && Number(r.user_id) !== Number(actor.id)) {
    throw ApiError.notFound('render job not found');
  }
  return {
    renderJobId: r.id,
    status: r.status,
    url: r.video_url || null,
    snapshotUrl: r.snapshot_url || null,
    errorMessage: r.error_message || null,
  };
}

/**
 * Download the finished render (the URL n8n returned) into our S3 so the post
 * can publish it. Called at post-submit time, not when the result dialog opens.
 */
export async function ingestRenderToS3(videoUrl, userId) {
  const url = assertFetchableUrl(videoUrl);
  const resp = await fetch(url);
  if (!resp.ok) throw new ApiError(502, `couldn't download the rendered video (HTTP ${resp.status})`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  const s3Key = `uploads/${userId}/${crypto.randomUUID()}-creatomate.mp4`;
  const { mediaUrl } = await putObject(s3Key, buffer, 'video/mp4');
  return { s3Key, mediaUrl, mediaType: 'video' };
}
