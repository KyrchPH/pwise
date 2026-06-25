import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import * as fbOauth from '../services/fb_oauth.service.js';
import * as pages from '../services/platform_accounts.service.js';

// "Connect with Facebook" OAuth import. The /callback is PUBLIC (a browser redirect
// from Facebook with no JWT — the signed `state` carries + verifies the user); the
// other three are admin-only API calls from the Settings UI.

// POST /api/pages/facebook/oauth-url — the Facebook dialog URL to send the browser to.
export const oauthUrl = asyncHandler(async (req, res) => {
  sendSuccess(res, { url: fbOauth.buildLoginUrl(req.user.id) });
});

// GET /api/pages/facebook/callback (PUBLIC) — Facebook redirects here after the user
// authorizes. Verify state, exchange the code for the user's pages (+ non-expiring
// tokens), stage them, and bounce back to Settings with the batch id for the picker.
// Always redirects to the SPA (never returns JSON) — it's a top-level browser nav.
export const callback = asyncHandler(async (req, res) => {
  const settingsUrl = `${env.clientUrl}/settings`;
  const fail = (msg) => res.redirect(`${settingsUrl}?fbimport_error=${encodeURIComponent(msg)}#facebook-pages`);

  if (req.query.error) {
    fail(String(req.query.error_description || req.query.error)); // user denied / FB error
    return;
  }
  try {
    const uid = fbOauth.verifyState(req.query.state);
    const found = await fbOauth.exchangeCodeForPages(req.query.code);
    if (!found.length) {
      fail('No Facebook Pages were found on this account.');
      return;
    }
    const existing = await pages.existingFbPageIds();
    const withFlag = found.map((p) => ({ ...p, alreadyConnected: existing.has(p.fbPageId) }));
    const batchId = fbOauth.stageDiscovery(uid, withFlag);
    res.redirect(`${settingsUrl}?fbimport=${batchId}#facebook-pages`);
  } catch (e) {
    fail(e?.message || 'Facebook sign-in failed.');
  }
});

// GET /api/pages/facebook/discovered?batch= — the staged pages for the picker (names +
// ids + alreadyConnected; NEVER the tokens). `expired` if the batch is gone/foreign.
export const discovered = asyncHandler(async (req, res) => {
  const d = fbOauth.getDiscovery(req.user.id, req.query.batch);
  if (!d) {
    sendSuccess(res, { expired: true, pages: [] });
    return;
  }
  sendSuccess(res, {
    expired: false,
    pages: d.pages.map((p) => ({ fb_page_id: p.fbPageId, name: p.name, alreadyConnected: !!p.alreadyConnected })),
  });
});

// POST /api/pages/facebook/import { batch, fb_page_ids } — import the selected staged
// pages: each is created (or its token refreshed if already connected) and
// auto-subscribed to Messenger. One-shot: the batch is consumed on success.
export const importPages = asyncHandler(async (req, res) => {
  const { batch, fb_page_ids } = req.body || {};
  const d = fbOauth.getDiscovery(req.user.id, batch);
  if (!d) throw ApiError.badRequest('This import session expired. Please connect with Facebook again.');
  const wanted = new Set((Array.isArray(fb_page_ids) ? fb_page_ids : []).map(String));
  const selected = d.pages.filter((p) => wanted.has(p.fbPageId));
  if (!selected.length) throw ApiError.badRequest('Select at least one page to import.');
  const results = await pages.importFromFacebook(req.user, selected);
  fbOauth.consumeDiscovery(req.user.id, batch);
  sendSuccess(res, { results });
});
