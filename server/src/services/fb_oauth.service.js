import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

// "Connect with Facebook" — server-side redirect OAuth that imports the Pages a user
// manages, each with a NON-EXPIRING page token. Page tokens only avoid expiry when
// minted from a LONG-LIVED user token (a short-lived one yields ~1h page tokens), so
// the callback does: code -> short-lived user token -> long-lived user token ->
// GET /me/accounts. The browser hits /callback directly (no JWT), so the initiating
// user id rides in a signed `state` (a short-lived JWT). Discovered pages are staged
// in memory keyed by a batch id so the user can pick which to import without us
// re-running OAuth.

// Scopes: list pages + Messenger (send/receive + webhook subscribe) + the existing
// post/insight/engagement features. App Review gates these for non-admin users in
// Live mode, but app admins/testers get them with Standard Access for testing.
const SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'business_management',
  // Instagram messaging on the linked professional account (Messenger Platform).
  'instagram_basic',
  'instagram_manage_messages',
].join(',');

const graphUrl = (path) => `https://graph.facebook.com/${env.facebook.graphVersion}/${path}`;

// Must match the URI registered in the Meta app (Strict Mode is on) AND be byte-identical
// between the dialog and the code exchange, or Facebook rejects it.
export const redirectUri = () => `${env.publicUrl}/api/pages/facebook/callback`;

export function isConfigured() {
  return !!(env.facebook.appId && env.facebook.appSecret && env.publicUrl);
}

// The Facebook OAuth dialog URL to send the browser to. `state` is a signed, short-
// lived JWT carrying the initiating user id (verified on callback).
export function buildLoginUrl(userId) {
  if (!isConfigured()) {
    throw ApiError.badRequest(
      'Connect with Facebook is not configured on the server (needs FACEBOOK_APP_ID, FB_APP_SECRET, and PUBLIC_URL).',
    );
  }
  const state = jwt.sign({ uid: userId, purpose: 'fb_oauth' }, env.jwtSecret, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: env.facebook.appId,
    redirect_uri: redirectUri(),
    state,
    scope: SCOPES,
    response_type: 'code',
  });
  return `https://www.facebook.com/${env.facebook.graphVersion}/dialog/oauth?${params.toString()}`;
}

export function verifyState(state) {
  let decoded;
  try {
    decoded = jwt.verify(String(state || ''), env.jwtSecret);
  } catch {
    throw ApiError.badRequest('The Facebook sign-in link expired or was invalid. Please try again.');
  }
  if (decoded.purpose !== 'fb_oauth' || decoded.uid == null) {
    throw ApiError.badRequest('Invalid Facebook sign-in state.');
  }
  return decoded.uid;
}

async function graphGet(path, params) {
  let res;
  try {
    res = await fetch(`${graphUrl(path)}?${new URLSearchParams(params).toString()}`);
  } catch (e) {
    throw new ApiError(502, `Facebook request failed: ${e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new ApiError(502, `Facebook: ${data.error?.message || 'request failed'}`);
  }
  return data;
}

// code -> short-lived user token -> long-lived user token -> the user's pages (each
// with a non-expiring page token). Returns [{ fbPageId, name, accessToken }].
export async function exchangeCodeForPages(code) {
  const short = await graphGet('oauth/access_token', {
    client_id: env.facebook.appId,
    client_secret: env.facebook.appSecret,
    redirect_uri: redirectUri(),
    code: String(code || ''),
  });
  // Exchange for a long-lived user token FIRST — this is what makes the page tokens
  // below non-expiring.
  const long = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: env.facebook.appId,
    client_secret: env.facebook.appSecret,
    fb_exchange_token: short.access_token,
  });
  const accounts = await graphGet('me/accounts', {
    // Also pull the linked Instagram professional account (if any) so the import can
    // auto-fill the IG channel — best-effort; the field is simply absent when unlinked.
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    limit: '100',
    access_token: long.access_token,
  });
  return (accounts.data || [])
    .filter((p) => p.id && p.access_token)
    .map((p) => ({
      fbPageId: String(p.id),
      name: p.name || `Page ${p.id}`,
      accessToken: p.access_token,
      igAccountId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
      igUsername: p.instagram_business_account?.username || null,
    }));
}

// ── Discovery staging (in-memory; single-process deploy, like presence) ──────
// Holds a user's discovered pages (incl. their tokens) briefly so they can pick which
// to import. Keyed by an unguessable batch id AND the owner's user id.
const discoveries = new Map(); // batchId -> { uid, at, pages }
const DISCOVERY_TTL_MS = 15 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - DISCOVERY_TTL_MS;
  for (const [id, d] of discoveries) if (d.at < cutoff) discoveries.delete(id);
}

export function stageDiscovery(uid, pages) {
  sweep();
  const batchId = crypto.randomBytes(18).toString('hex');
  discoveries.set(batchId, { uid: Number(uid), at: Date.now(), pages });
  return batchId;
}

export function getDiscovery(uid, batchId) {
  sweep();
  const d = discoveries.get(String(batchId || ''));
  if (!d || d.uid !== Number(uid)) return null;
  return d;
}

export function consumeDiscovery(uid, batchId) {
  const d = getDiscovery(uid, batchId);
  if (d) discoveries.delete(String(batchId));
  return d;
}
