import { query } from '../config/db.js';
import * as fb from './fb.service.js';
import * as accounts from './platform_accounts.service.js';

// Daily page-level metrics we warehouse — confirmed available on the page (the
// retired page_fans/page_fan_adds/demographics names are intentionally absent).
export const PAGE_METRICS = [
  'page_impressions_unique', // page reach
  'page_posts_impressions', // post impressions
  'page_posts_impressions_unique', // post reach
  'page_post_engagements', // engagement
  'page_daily_follows_unique', // new follows
  'page_daily_unfollows_unique', // unfollows
];

async function upsertDaily(accountId, metric, points = []) {
  for (const p of points) {
    if (!p.date) continue;
    await query(
      `INSERT INTO page_insight_daily (account_id, captured_on, metric, value) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [accountId ?? null, p.date, metric, Math.round(Number(p.value) || 0)],
    );
  }
}

// Pull `days` of metrics for ONE page from Meta and store them tagged with its
// account id. `page` = { accountId, token, fbPageId }. Best-effort.
export async function refreshPageInsights(days = 30, page = {}) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  let series;
  try {
    series = await fb.fetchPageInsights(PAGE_METRICS, since, until, { token: page.token, fbPageId: page.fbPageId });
  } catch {
    return { ok: false };
  }
  for (const metric of Object.keys(series)) {
    await upsertDaily(page.accountId ?? null, metric, series[metric]);
  }
  return { ok: true, metrics: Object.keys(series).length };
}

// Refresh every connected, active page — used by the n8n hourly snapshot job.
export async function refreshAllPages(days = 7) {
  const pages = await accounts.list();
  let refreshed = 0;
  for (const p of pages) {
    if (!p.is_active) continue;
    try {
      const dec = await accounts.getDecrypted(p.id);
      const r = await refreshPageInsights(days, { accountId: p.id, token: dec.access_token, fbPageId: dec.fb_page_id });
      if (r.ok) refreshed += 1;
    } catch {
      /* skip this page */
    }
  }
  return { pages: pages.length, refreshed };
}

async function warehouseEmpty(accountId) {
  const rows =
    accountId != null
      ? await query('SELECT 1 FROM page_insight_daily WHERE account_id = ? LIMIT 1', [accountId])
      : await query('SELECT 1 FROM page_insight_daily LIMIT 1');
  return rows.length === 0;
}

// Everything the Analytics page needs for the ACTIVE page: the per-metric daily
// series for the range, the current follower count, and a top-posts ranking.
// On first use for a page (empty warehouse) it backfills ~90 days from Meta.
export async function overview({ rangeDays = 28, accountId = null, token = null, fbPageId = null } = {}) {
  // No active page → no page analytics. Don't fall back to the whole warehouse
  // (which would surface another page's or orphaned data when nothing is connected).
  if (accountId == null) {
    const empty = {};
    for (const m of PAGE_METRICS) empty[m] = [];
    return { rangeDays, followers: null, pageName: null, series: empty, ranking: [] };
  }

  if (await warehouseEmpty(accountId)) {
    await refreshPageInsights(90, { accountId, token, fbPageId }); // one-time backfill for this page
  }

  const sinceDate = new Date(Date.now() - rangeDays * 86400 * 1000).toISOString().slice(0, 10);
  const where = ['captured_on >= ?'];
  const params = [sinceDate];
  if (accountId != null) {
    where.push('account_id = ?');
    params.push(accountId);
  }
  const rows = await query(
    `SELECT DATE_FORMAT(captured_on, '%Y-%m-%d') AS date, metric, value
       FROM page_insight_daily
      WHERE ${where.join(' AND ')}
      ORDER BY captured_on ASC`,
    params,
  );
  const series = {};
  for (const m of PAGE_METRICS) series[m] = [];
  for (const r of rows) {
    if (!series[r.metric]) series[r.metric] = [];
    series[r.metric].push({ period: r.date, value: Number(r.value) });
  }

  const profile = await fb.fetchPageProfile({ token, fbPageId }).catch(() => null);

  const rankWhere = ["status = 'posted'"];
  const rankParams = [];
  if (accountId != null) {
    rankWhere.push('account_id = ?');
    rankParams.push(accountId);
  }
  const ranking = await query(
    `SELECT id, caption, media_type, posted_at,
            reactions_count, comments_count, shares_count, views_count,
            (COALESCE(reactions_count, 0) + COALESCE(comments_count, 0) + COALESCE(shares_count, 0)) AS engagement
       FROM post_pool
      WHERE ${rankWhere.join(' AND ')}
      ORDER BY engagement DESC, posted_at DESC
      LIMIT 8`,
    rankParams,
  );

  return {
    rangeDays,
    followers: profile?.followers ?? profile?.fans ?? null,
    pageName: profile?.name ?? null,
    series,
    ranking,
  };
}
