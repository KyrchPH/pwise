import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/analytics.service.js';
import * as settings from '../services/settings.service.js';
import * as accounts from '../services/platform_accounts.service.js';

// Page analytics overview for the Analytics dashboard, scoped to the caller's
// active page. `range` = days (7..365).
export const overview = asyncHandler(async (req, res) => {
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
  const data = await service.overview({ rangeDays, accountId, token, fbPageId });
  sendSuccess(res, data);
});
