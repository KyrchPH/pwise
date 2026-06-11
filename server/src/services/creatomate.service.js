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

// Pull the rendered video URL out of whatever shape n8n responds with.
function extractRenderUrl(body) {
  const obj = Array.isArray(body) ? body[0] : body;
  return obj?.url || obj?.video_url || obj?.output_url || obj?.data?.url || null;
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
 * Trigger an n8n render for a saved template + the just-uploaded input video,
 * and return the rendered video URL n8n (→ Creatomate) responds with. The
 * request stays open for the whole render, so the n8n webhook must be set to
 * respond when its flow finishes.
 */
export async function startRender(templateDbId, { videoS3Key = null, caption = null } = {}) {
  ensureWebhook();
  const tpl = await getById(templateDbId); // 404s if the template is gone
  const cfg = parseStoredConfig(tpl.config);

  const videoUrl = videoS3Key ? await createDownloadUrl(videoS3Key) : null;
  const modifications = { ...(cfg.modifications || {}) };
  if (videoUrl) modifications[env.creatomate.videoKey] = videoUrl;

  const headers = { 'Content-Type': 'application/json' };
  if (env.n8n.webhookToken) headers['x-service-token'] = env.n8n.webhookToken;

  // The input clip stays in S3 under tmp/ — the client deletes it on "Drop &
  // close", and an S3 lifecycle rule on tmp/ expires any that slip through.
  let res;
  try {
    res = await fetch(env.n8n.generateWebhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        for_automation: true, // routes n8n's "Is For Automated Editing?" IF to the render branch
        template_id: cfg.template_id,
        video_url: videoUrl,
        caption,
        page_id: env.facebook.pageId || null,
        modifications,
      }),
      signal: AbortSignal.timeout(4 * 60 * 1000), // renders can take a while
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new ApiError(504, 'the render timed out — try again');
    throw new ApiError(502, `couldn't reach the n8n render webhook: ${err.message}`);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, `n8n render webhook error: ${body?.message || res.statusText}`);

  const url = extractRenderUrl(body);
  if (!url) {
    throw new ApiError(502, 'n8n did not return a rendered video URL (is the webhook set to respond with the render result?)');
  }
  return { url };
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
