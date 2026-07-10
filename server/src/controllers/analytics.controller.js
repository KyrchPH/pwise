import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/analytics.service.js';
import * as settings from '../services/settings.service.js';
import * as accounts from '../services/platform_accounts.service.js';

// Page analytics overview for the Analytics dashboard, scoped to the caller's
// active page. `range` = days (7..1825), so the UI can bucket years when the
// warehouse has enough history.
export const overview = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 7), 1825);
  // Optional ?accountId scopes to a specific (workspace-shared) page — used by the
  // per-post insights tab; otherwise fall back to the caller's active page.
  const reqAccount = Number(req.query.accountId);
  const accountId = Number.isInteger(reqAccount) && reqAccount > 0 ? reqAccount : await settings.getSelectedAccountId(req.user.id);
  let token = null;
  let fbPageId = null;
  if (accountId != null) {
    try {
      const a = await accounts.getDecrypted(accountId);
      token = a.access_token;
      fbPageId = a.fb_page_id;
    } catch {
      /* page gone — fall back to env in fb.service */
    }
  }
  const data = await service.overview({ rangeDays, accountId, token, fbPageId });
  sendSuccess(res, data);
});

// Insights ("Performance") tab: a card model with per-metric current total, % change vs the
// previous window, sub-metrics, and a sparkline. Same page scoping as overview.
export const insights = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 7), 365);
  const accountId = await settings.getSelectedAccountId(req.user.id);
  let token = null;
  let fbPageId = null;
  if (accountId != null) {
    try {
      const a = await accounts.getDecrypted(accountId);
      token = a.access_token;
      fbPageId = a.fb_page_id;
    } catch {
      /* page gone — fall back to env in fb.service */
    }
  }
  const data = await service.insightsOverview({ rangeDays, accountId, token, fbPageId });
  sendSuccess(res, data);
});

// All active connected pages in one table: follows, unfollows, visits and current followers.
export const allPagesMetrics = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 7), 365);
  const data = await service.allPagesMetricsReport({ rangeDays });
  sendSuccess(res, data);
});

// Insights "Overview" tab: a one-request digest — headline page-metric tiles,
// messaging headlines, follower count, and the range's top posts. Same page
// scoping as insights.
export const highlights = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 7), 365);
  const accountId = await settings.getSelectedAccountId(req.user.id);
  let token = null;
  let fbPageId = null;
  if (accountId != null) {
    try {
      const a = await accounts.getDecrypted(accountId);
      token = a.access_token;
      fbPageId = a.fb_page_id;
    } catch {
      /* page gone — fall back to env in fb.service */
    }
  }
  const data = await service.highlights({ rangeDays, accountId, token, fbPageId });
  sendSuccess(res, data);
});

// Messaging ("Contacts") tab: everyone who messaged the active page over the range,
// split into new vs returning and broken down by channel. Purely app-side data —
// no Meta call needed, so no token/page scoping beyond the caller's active page.
export const messaging = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 7), 365);
  const accountId = await settings.getSelectedAccountId(req.user.id);
  const data = await service.messaging({ rangeDays, accountId });
  sendSuccess(res, data);
});

// Contents tab: every published post for the active page within the range with its
// per-post engagement (views / interactions / reactions / comments / shares). App-side
// data already warehoused on post_pool — same active-page scoping as messaging.
export const contents = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 7), 365);
  const accountId = await settings.getSelectedAccountId(req.user.id);
  const data = await service.contentPerformance({ rangeDays, accountId });
  sendSuccess(res, data);
});
