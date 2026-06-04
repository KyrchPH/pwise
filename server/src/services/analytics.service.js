import { query } from '../config/db.js';
import * as fb from './fb.service.js';

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

async function upsertDaily(metric, points = []) {
  for (const p of points) {
    if (!p.date) continue;
    await query(
      `INSERT INTO page_insight_daily (captured_on, metric, value) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [p.date, metric, Math.round(Number(p.value) || 0)],
    );
  }
}

// Pull `days` of page metrics from Meta and store them. Used for the one-time
// backfill (large window) and the scheduled refresh (small window). Best-effort.
export async function refreshPageInsights(days = 30) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  let series;
  try {
    series = await fb.fetchPageInsights(PAGE_METRICS, since, until);
  } catch {
    return { ok: false };
  }
  for (const metric of Object.keys(series)) {
    await upsertDaily(metric, series[metric]);
  }
  return { ok: true, metrics: Object.keys(series).length };
}

async function warehouseEmpty() {
  const rows = await query('SELECT 1 FROM page_insight_daily LIMIT 1');
  return rows.length === 0;
}

// Everything the Analytics page needs: the per-metric daily series for the range,
// the current follower count, and a top-posts ranking from stored engagement.
// On first use (empty warehouse) it backfills ~90 days from Meta (served history).
export async function overview({ rangeDays = 28 } = {}) {
  if (await warehouseEmpty()) {
    await refreshPageInsights(90); // one-time backfill
  }

  const sinceDate = new Date(Date.now() - rangeDays * 86400 * 1000).toISOString().slice(0, 10);
  const rows = await query(
    `SELECT DATE_FORMAT(captured_on, '%Y-%m-%d') AS date, metric, value
       FROM page_insight_daily
      WHERE captured_on >= ?
      ORDER BY captured_on ASC`,
    [sinceDate],
  );
  const series = {};
  for (const m of PAGE_METRICS) series[m] = [];
  for (const r of rows) {
    if (!series[r.metric]) series[r.metric] = [];
    series[r.metric].push({ period: r.date, value: Number(r.value) });
  }

  const profile = await fb.fetchPageProfile().catch(() => null);

  const ranking = await query(
    `SELECT id, caption, media_type, posted_at,
            reactions_count, comments_count, shares_count, views_count,
            (COALESCE(reactions_count, 0) + COALESCE(comments_count, 0) + COALESCE(shares_count, 0)) AS engagement
       FROM post_pool
      WHERE status = 'posted'
      ORDER BY engagement DESC, posted_at DESC
      LIMIT 8`,
  );

  return {
    rangeDays,
    followers: profile?.followers ?? profile?.fans ?? null,
    pageName: profile?.name ?? null,
    series,
    ranking,
  };
}
