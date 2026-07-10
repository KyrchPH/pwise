import { query } from '../config/db.js';
import * as fb from './fb.service.js';
import * as accounts from './platform_accounts.service.js';
import { createDownloadUrl } from './s3.service.js';

// Daily page-level metrics we warehouse. Around 2026-06-17 Meta retired the whole
// page-level impressions/reach family (page_impressions*, page_posts_impressions*)
// on every Graph version, so those names are gone from this list: "Views" is now
// computed from our own per-post records (post_pool.views_count, see postViewsStat)
// and "Viewers" (unique reach) has no replacement at all. page_views_total is also
// retired but kept as a cheap probe so the metric auto-heals if Meta revives it.
// Historical impressions rows remain in page_insight_daily and still feed charts.
export const PAGE_METRICS = [
  'page_post_engagements', // engagement
  'page_daily_follows_unique', // new follows
  'page_daily_unfollows_unique', // unfollows
  'page_views_total', // page visits (retired — probed best-effort)
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
// account id. `page` = { accountId, token, fbPageId }. Every metric is fetched in
// its OWN request: a single retired name 400s a whole batched insights call, which
// is exactly how the warehouse silently stopped filling for three weeks when Meta
// dropped the impressions metrics. Best-effort per metric.
export async function refreshPageInsights(days = 30, page = {}) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  let served = 0;
  for (const metric of PAGE_METRICS) {
    try {
      const series = await fb.fetchPageInsights([metric], since, until, { token: page.token, fbPageId: page.fbPageId });
      for (const m of Object.keys(series)) await upsertDaily(page.accountId ?? null, m, series[m]);
      served += 1;
    } catch {
      /* metric retired or transient error — never let one metric sink the others */
    }
  }
  return { ok: served > 0, metrics: served };
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

// ── Insights ("Performance") tab ──────────────────────────────────────────────
const DAY_MS = 86400 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// % change vs the previous window. null = "no prior baseline" (client shows no delta).
function changePct(cur, prev) {
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// Expand a sparse daily result ([{ period:'YYYY-MM-DD', n }]) into a continuous
// day-by-day series across [startIso, endIso], filling missing days with 0 so a
// chart's x-axis spans the whole selected period (not just days that had data).
// UTC-stepped to stay consistent with isoDay's UTC day boundaries.
function fillDailySeries(rows, startIso, endIso) {
  const byDay = new Map(rows.map((r) => [r.period, Number(r.n)]));
  const end = Date.parse(`${endIso}T00:00:00Z`);
  const out = [];
  for (let t = Date.parse(`${startIso}T00:00:00Z`); t <= end; t += DAY_MS) {
    const iso = new Date(t).toISOString().slice(0, 10);
    out.push({ period: iso, value: byDay.get(iso) || 0 });
  }
  return out;
}

// Current-window total, % change vs the previous window, and the current-window daily series
// for one warehoused metric. Metrics never served by Meta have no rows → available:false.
function metricStat(byMetric, metric, midDate) {
  const pts = byMetric[metric];
  if (!pts || pts.length === 0) return { total: 0, changePct: null, series: [], available: false };
  const cur = pts.filter((p) => p.period >= midDate);
  const prev = pts.filter((p) => p.period < midDate);
  const sum = (a) => a.reduce((s, p) => s + p.value, 0);
  const c = sum(cur);
  return { total: c, changePct: changePct(c, sum(prev)), series: cur, available: true };
}

// Net follows = follows − unfollows, per day (for the trend) and summed per window (for the delta).
function netFollowsStat(byMetric, midDate) {
  const f = byMetric.page_daily_follows_unique;
  const u = byMetric.page_daily_unfollows_unique;
  if ((!f || !f.length) && (!u || !u.length)) return { total: 0, changePct: null, series: [], available: false };
  const fMap = new Map((f || []).map((p) => [p.period, p.value]));
  const uMap = new Map((u || []).map((p) => [p.period, p.value]));
  const dates = [...new Set([...(f || []), ...(u || [])].map((p) => p.period))].sort();
  const net = (d) => (fMap.get(d) || 0) - (uMap.get(d) || 0);
  const series = dates.filter((d) => d >= midDate).map((d) => ({ period: d, value: net(d) }));
  const winSum = (cur) => dates.filter((d) => (cur ? d >= midDate : d < midDate)).reduce((s, d) => s + net(d), 0);
  const c = winSum(true);
  return { total: c, changePct: changePct(c, winSum(false)), series, available: true };
}

// "Views" from our own records: per-post view counts warehoused on post_pool by the
// hourly engagement sync, attributed to each post's publish date (same source as the
// Contents tab). Meta retired the page-level impressions metrics (see PAGE_METRICS),
// so this is the durable replacement. Always available — our records are authoritative
// even when the answer is zero.
async function postViewsStat(accountId, sinceDate, midDate, untilDate) {
  const totals = await query(
    `SELECT (posted_at >= ?) AS cur, SUM(COALESCE(views_count, 0)) AS n
       FROM post_pool
      WHERE account_id = ? AND status = 'posted' AND posted_at IS NOT NULL AND posted_at >= ?
      GROUP BY (posted_at >= ?)`,
    [midDate, accountId, sinceDate, midDate],
  );
  let cur = 0;
  let prev = 0;
  for (const r of totals) {
    if (Number(r.cur)) cur = Number(r.n);
    else prev = Number(r.n);
  }
  const daily = await query(
    `SELECT DATE_FORMAT(posted_at, '%Y-%m-%d') AS period, SUM(COALESCE(views_count, 0)) AS n
       FROM post_pool
      WHERE account_id = ? AND status = 'posted' AND posted_at IS NOT NULL AND posted_at >= ?
      GROUP BY period ORDER BY period ASC`,
    [accountId, midDate],
  );
  return { total: cur, changePct: changePct(cur, prev), series: fillDailySeries(daily, midDate, untilDate), available: true };
}

const VIEWS_INFO = 'Views on the content you published in this period, from your per-post records.';

// App-side Conversations metrics (our own data — always reliable, range-scoped): started,
// new contacts, and a response-rate proxy. Each returned as its own card with a daily trend.
async function conversationCards(accountId, midDate, sinceDate) {
  if (accountId == null) return [];

  const grouped = await query(
    `SELECT (created_at >= ?) AS cur, COUNT(*) AS started, COUNT(DISTINCT customer_handle) AS contacts
       FROM conversations WHERE account_id = ? AND created_at >= ? GROUP BY (created_at >= ?)`,
    [midDate, accountId, sinceDate, midDate],
  );
  let cS = 0; let pS = 0; let cC = 0; let pC = 0;
  for (const r of grouped) {
    if (Number(r.cur)) { cS = Number(r.started); cC = Number(r.contacts); }
    else { pS = Number(r.started); pC = Number(r.contacts); }
  }

  const daily = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS period, COUNT(*) AS started, COUNT(DISTINCT customer_handle) AS contacts
       FROM conversations WHERE account_id = ? AND created_at >= ? GROUP BY period ORDER BY period ASC`,
    [accountId, midDate],
  );
  const startedSeries = daily.map((r) => ({ period: r.period, value: Number(r.started) }));
  const contactsSeries = daily.map((r) => ({ period: r.period, value: Number(r.contacts) }));

  let responseRate = null;
  try {
    const rr = await query(
      `SELECT COUNT(DISTINCT CASE WHEN m.side = 'incoming' THEN m.conversation_id END) AS asked,
              COUNT(DISTINCT CASE WHEN m.side = 'outgoing' THEN m.conversation_id END) AS answered
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.account_id = ? AND m.created_at >= ?`,
      [accountId, midDate],
    );
    const asked = Number(rr[0]?.asked || 0);
    const answered = Number(rr[0]?.answered || 0);
    responseRate = asked > 0 ? Math.round((answered / asked) * 1000) / 10 : null;
  } catch {
    responseRate = null;
  }

  return [
    { key: 'conversations_started', title: 'Conversations started', info: 'New message threads customers started in this period.', total: cS, changePct: changePct(cS, pS), series: startedSeries, available: true },
    { key: 'new_contacts', title: 'New contacts', info: 'Distinct customers who messaged your Page in this period.', total: cC, changePct: changePct(cC, pC), series: contactsSeries, available: true },
    { key: 'response_rate', title: 'Response rate', info: 'Share of active conversations that received a reply.', total: responseRate, changePct: null, series: [], available: responseRate != null, format: 'percent' },
  ];
}

// Card model for the Insights tab: ONE card per metric — its current-window total, % change vs
// the preceding equal window, and the current-window daily series (for a full chart). Reads the
// same warehouse as overview() over 2× the range, split at the midpoint. Metrics Meta didn't
// serve come back available:false so the client shows "n/a".
export async function insightsOverview({ rangeDays = 28, accountId = null, token = null, fbPageId = null } = {}) {
  const now = Date.now();
  const midDate = isoDay(now - rangeDays * DAY_MS); // start of the current window (inclusive)
  const sinceDate = isoDay(now - 2 * rangeDays * DAY_MS); // start of the previous window

  const byMetric = {}; // metric -> [{ period, value }]
  let profile = null;
  if (accountId != null) {
    profile = await fb.fetchPageProfile({ token, fbPageId }).catch(() => null);
    if (await warehouseEmpty(accountId)) await refreshPageInsights(90, { accountId, token, fbPageId });
    const rows = await query(
      `SELECT DATE_FORMAT(captured_on, '%Y-%m-%d') AS date, metric, value
         FROM page_insight_daily WHERE account_id = ? AND captured_on >= ? ORDER BY captured_on ASC`,
      [accountId, sinceDate],
    );
    for (const r of rows) (byMetric[r.metric] ||= []).push({ period: r.date, value: Number(r.value) });
  }

  const card = (key, title, metric, info, extra = {}) => ({ key, title, info, ...metricStat(byMetric, metric, midDate), ...extra });

  // Views from our own per-post records; "Viewers" (unique reach) is gone for good —
  // Meta retired the metric and it can't be rebuilt from per-post data, so no card.
  const untilDate = isoDay(now);
  const viewsStat =
    accountId != null
      ? await postViewsStat(accountId, sinceDate, midDate, untilDate)
      : { total: 0, changePct: null, series: [], available: false };

  const metricCards = [
    { key: 'views', title: 'Views', info: VIEWS_INFO, ...viewsStat },
    card('interactions', 'Content interactions', 'page_post_engagements', 'Reactions, comments, shares and clicks on your content.'),
    card('visits', 'Visits', 'page_views_total', 'Times your Page profile was visited.'),
    card('follows', 'Follows', 'page_daily_follows_unique', 'New follows in this period.'),
    card('unfollows', 'Unfollows', 'page_daily_unfollows_unique', 'Follows lost in this period.'),
    { key: 'net_follows', title: 'Net follows', info: 'Follows minus unfollows.', ...netFollowsStat(byMetric, midDate) },
  ];

  const convCards = await conversationCards(accountId, midDate, sinceDate);

  return { rangeDays, pageName: profile?.name ?? null, sinceDate, untilDate, cards: [...metricCards, ...convCards] };
}

// All-pages report: one row per active connected page, using the same page-level
// warehouse as the Performance tab. Missing metric rows are kept as null so the
// PDF can show a dash instead of turning unavailable Meta data into a false zero.
const ALL_PAGES_REPORT_METRICS = {
  follows: 'page_daily_follows_unique',
  unfollows: 'page_daily_unfollows_unique',
  visits: 'page_views_total',
};
const REPORT_KEY_BY_METRIC = Object.fromEntries(Object.entries(ALL_PAGES_REPORT_METRICS).map(([key, metric]) => [metric, key]));

export async function allPagesMetricsReport({ rangeDays = 28 } = {}) {
  const now = Date.now();
  const untilDate = isoDay(now);
  const sinceDate = isoDay(now - Math.max(0, rangeDays - 1) * DAY_MS);
  const pages = (await accounts.list()).filter((page) => page.is_active);
  const pageIds = pages.map((page) => Number(page.id));

  for (const page of pages) {
    try {
      if (!(await warehouseEmpty(page.id))) continue;
      const dec = await accounts.getDecrypted(page.id);
      await refreshPageInsights(Math.max(90, rangeDays), {
        accountId: page.id,
        token: dec.access_token,
        fbPageId: dec.fb_page_id,
      });
    } catch {
      /* one dead token should not prevent the rest of the report */
    }
  }

  const byAccount = new Map(pageIds.map((id) => [id, { follows: null, unfollows: null, visits: null }]));
  const metricNames = Object.values(ALL_PAGES_REPORT_METRICS);
  if (pageIds.length) {
    const accountPlaceholders = pageIds.map(() => '?').join(',');
    const metricPlaceholders = metricNames.map(() => '?').join(',');
    const rows = await query(
      `SELECT account_id, metric, SUM(value) AS total
         FROM page_insight_daily
        WHERE account_id IN (${accountPlaceholders})
          AND captured_on >= ?
          AND captured_on <= ?
          AND metric IN (${metricPlaceholders})
        GROUP BY account_id, metric`,
      [...pageIds, sinceDate, untilDate, ...metricNames],
    );
    for (const row of rows) {
      const key = REPORT_KEY_BY_METRIC[row.metric];
      const accountId = Number(row.account_id);
      if (!key || !byAccount.has(accountId)) continue;
      byAccount.get(accountId)[key] = Number(row.total) || 0;
    }
  }

  const reportRows = [];
  for (const page of pages) {
    const stats = await accounts.getStats(page.id).catch(() => null);
    reportRows.push({
      accountId: Number(page.id),
      accountName: stats?.name || page.account_name || `Page #${page.id}`,
      follows: byAccount.get(Number(page.id))?.follows ?? null,
      unfollows: byAccount.get(Number(page.id))?.unfollows ?? null,
      visits: byAccount.get(Number(page.id))?.visits ?? null,
      currentFollowers: stats?.followers ?? null,
    });
  }

  return { rangeDays, sinceDate, untilDate, rows: reportRows };
}

// ── Messaging ("Contacts") tab ────────────────────────────────────────────────
// Everyone who messaged the ACTIVE page over the range, split into new vs
// returning and broken down by channel (origin). All app-side data — reliable and
// range-scoped, no dependency on Meta's (deprecated) demographic metrics.
//
// One conversation row == one customer per page: an inbound message reuses the
// existing thread for that customer_handle (see resolveOrCreateConversation), so a
// distinct handle identifies a contact and conversations.created_at is that
// customer's first-ever contact date. That makes "new" (created in window) vs
// "returning" (active in window but created earlier) a clean split.

// Stable per-customer identity for COUNT(DISTINCT): the handle when present, else
// the conversation id so a thread with no handle still counts once.
const CONTACT_ID = "COALESCE(c.customer_handle, CONCAT('c#', c.id))";

// Fold per-origin rows tagged cur=1/0 into { total, changePct, channels } where
// each channel carries its own current value + change vs the previous window.
function foldChannels(rows) {
  const cur = new Map();
  const prev = new Map();
  for (const r of rows) {
    const bucket = Number(r.cur) ? cur : prev;
    bucket.set(r.origin, (bucket.get(r.origin) || 0) + Number(r.n));
  }
  const origins = [...new Set([...cur.keys(), ...prev.keys()])];
  const channels = origins
    .map((o) => ({ origin: o, value: cur.get(o) || 0, changePct: changePct(cur.get(o) || 0, prev.get(o) || 0) }))
    .filter((ch) => ch.value > 0)
    .sort((a, b) => b.value - a.value);
  const sum = (m) => [...m.values()].reduce((s, v) => s + v, 0);
  const curTotal = sum(cur);
  return { total: curTotal, changePct: changePct(curTotal, sum(prev)), channels };
}

// ── Insights "Overview" tab ───────────────────────────────────────────────────
// A one-request digest of the deeper tabs: the headline page metrics from the
// warehouse (as selectable tiles, each with its daily trend), the two messaging
// headlines (app-side, same definitions as messaging()), the follower count,
// and the top posts of the range by engagement.
export async function highlights({ rangeDays = 28, accountId = null, token = null, fbPageId = null } = {}) {
  const now = Date.now();
  const curStart = isoDay(now - rangeDays * DAY_MS); // start of the current window (inclusive)
  const prevStart = isoDay(now - 2 * rangeDays * DAY_MS); // start of the previous window
  const untilDate = isoDay(now);

  if (accountId == null) {
    return { rangeDays, pageName: null, followers: null, sinceDate: curStart, untilDate, tiles: [], topPosts: [] };
  }

  const profile = await fb.fetchPageProfile({ token, fbPageId }).catch(() => null);
  if (await warehouseEmpty(accountId)) await refreshPageInsights(90, { accountId, token, fbPageId });

  const rows = await query(
    `SELECT DATE_FORMAT(captured_on, '%Y-%m-%d') AS date, metric, value
       FROM page_insight_daily WHERE account_id = ? AND captured_on >= ? ORDER BY captured_on ASC`,
    [accountId, prevStart],
  );
  const byMetric = {}; // metric -> [{ period, value }]
  for (const r of rows) (byMetric[r.metric] ||= []).push({ period: r.date, value: Number(r.value) });

  const tile = (key, title, metric, info) => ({ key, title, info, ...metricStat(byMetric, metric, curStart) });

  // Messaging headlines — current vs previous window totals + a current-window
  // daily series each, so they can drive the tile chart like the page metrics.
  const contactTotals = await query(
    `SELECT (m.created_at >= ?) AS cur, COUNT(DISTINCT ${CONTACT_ID}) AS n
       FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.account_id = ? AND m.side = 'incoming' AND m.created_at >= ?
      GROUP BY (m.created_at >= ?)`,
    [curStart, accountId, prevStart, curStart],
  );
  const startedTotals = await query(
    `SELECT (created_at >= ?) AS cur, COUNT(*) AS n
       FROM conversations WHERE account_id = ? AND created_at >= ? GROUP BY (created_at >= ?)`,
    [curStart, accountId, prevStart, curStart],
  );
  const split = (grouped) => {
    let cur = 0;
    let prev = 0;
    for (const r of grouped) {
      if (Number(r.cur)) cur = Number(r.n);
      else prev = Number(r.n);
    }
    return { cur, prev };
  };
  const contactSeriesRows = await query(
    `SELECT DATE_FORMAT(m.created_at, '%Y-%m-%d') AS period, COUNT(DISTINCT ${CONTACT_ID}) AS n
       FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.account_id = ? AND m.side = 'incoming' AND m.created_at >= ?
      GROUP BY period ORDER BY period ASC`,
    [accountId, curStart],
  );
  const startedSeriesRows = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS period, COUNT(*) AS n
       FROM conversations WHERE account_id = ? AND created_at >= ?
      GROUP BY period ORDER BY period ASC`,
    [accountId, curStart],
  );
  const contacts = split(contactTotals);
  const started = split(startedTotals);

  // Views from our own per-post records; the retired "Viewers" tile is gone (see PAGE_METRICS).
  const viewsStat = await postViewsStat(accountId, prevStart, curStart, untilDate);

  const tiles = [
    { key: 'views', title: 'Views', info: VIEWS_INFO, ...viewsStat },
    tile('interactions', 'Content interactions', 'page_post_engagements', 'Reactions, comments, shares and clicks on your content.'),
    { key: 'net_follows', title: 'Net follows', info: 'Follows minus unfollows.', ...netFollowsStat(byMetric, curStart) },
    {
      key: 'total_contacts',
      title: 'Total contacts',
      info: 'People who sent your Page a message in this period.',
      total: contacts.cur,
      changePct: changePct(contacts.cur, contacts.prev),
      series: fillDailySeries(contactSeriesRows, curStart, untilDate),
      available: true,
    },
    {
      key: 'conversations_started',
      title: 'Conversations started',
      info: 'New message threads opened in this period.',
      total: started.cur,
      changePct: changePct(started.cur, started.prev),
      series: fillDailySeries(startedSeriesRows, curStart, untilDate),
      available: true,
    },
  ];

  // Top posts of the range by engagement (unlike overview()'s all-time ranking).
  const topPosts = await query(
    `SELECT id, caption, media_type, posted_at,
            reactions_count, comments_count, shares_count,
            (COALESCE(reactions_count, 0) + COALESCE(comments_count, 0) + COALESCE(shares_count, 0)) AS engagement
       FROM post_pool
      WHERE status = 'posted' AND account_id = ? AND posted_at >= ?
      ORDER BY engagement DESC, posted_at DESC
      LIMIT 5`,
    [accountId, curStart],
  );

  return {
    rangeDays,
    pageName: profile?.name ?? null,
    followers: profile?.followers ?? profile?.fans ?? null,
    sinceDate: curStart,
    untilDate,
    tiles,
    topPosts,
  };
}

export async function messaging({ rangeDays = 28, accountId = null } = {}) {
  const now = Date.now();
  const curStart = isoDay(now - rangeDays * DAY_MS); // start of the current window (inclusive)
  const prevStart = isoDay(now - 2 * rangeDays * DAY_MS); // start of the previous window
  const untilDate = isoDay(now);

  const emptyMetric = { total: 0, changePct: null, channels: [] };
  if (accountId == null) {
    return {
      rangeDays,
      pageName: null,
      sinceDate: curStart,
      untilDate,
      totalContacts: emptyMetric,
      conversationsStarted: emptyMetric,
      newContacts: emptyMetric,
      returningContacts: emptyMetric,
      sales: { total: 0, changePct: null, revenue: 0, currency: 'PHP', byStatus: [], conversations: 0, conversionRate: null },
      series: { totalContacts: [], conversationsStarted: [] },
    };
  }

  // Total contacts by channel — distinct customers with an inbound message in the
  // current vs previous window.
  const contactRows = await query(
    `SELECT COALESCE(c.origin, 'Other') AS origin, (m.created_at >= ?) AS cur, COUNT(DISTINCT ${CONTACT_ID}) AS n
       FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.account_id = ? AND m.side = 'incoming' AND m.created_at >= ?
      GROUP BY origin, (m.created_at >= ?)`,
    [curStart, accountId, prevStart, curStart],
  );

  // New contacts (== conversations started) by channel — a first-ever contact opens
  // a new thread, so both come from conversations.created_at.
  const newRows = await query(
    `SELECT COALESCE(origin, 'Other') AS origin, (created_at >= ?) AS cur, COUNT(*) AS n
       FROM conversations WHERE account_id = ? AND created_at >= ?
      GROUP BY origin, (created_at >= ?)`,
    [curStart, accountId, prevStart, curStart],
  );

  // Returning contacts — active (inbound) in the current window but first contacted
  // before it. Current window by channel + a prior-window scalar for the delta.
  const retCurRows = await query(
    `SELECT COALESCE(c.origin, 'Other') AS origin, COUNT(DISTINCT ${CONTACT_ID}) AS n
       FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.account_id = ? AND m.side = 'incoming' AND m.created_at >= ? AND c.created_at < ?
      GROUP BY origin`,
    [accountId, curStart, curStart],
  );
  const retPrevRows = await query(
    `SELECT COUNT(DISTINCT ${CONTACT_ID}) AS n
       FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.account_id = ? AND m.side = 'incoming' AND m.created_at >= ? AND m.created_at < ? AND c.created_at < ?`,
    [accountId, prevStart, curStart, prevStart],
  );

  // Daily series (current window) for the two headline metrics.
  const contactSeriesRows = await query(
    `SELECT DATE_FORMAT(m.created_at, '%Y-%m-%d') AS period, COUNT(DISTINCT ${CONTACT_ID}) AS n
       FROM conversations c JOIN messages m ON m.conversation_id = c.id
      WHERE c.account_id = ? AND m.side = 'incoming' AND m.created_at >= ?
      GROUP BY period ORDER BY period ASC`,
    [accountId, curStart],
  );
  const startedSeriesRows = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS period, COUNT(*) AS n
       FROM conversations WHERE account_id = ? AND created_at >= ?
      GROUP BY period ORDER BY period ASC`,
    [accountId, curStart],
  );

  // Attributed sales — orders linked back to a conversation on this page (the ones
  // started from the inbox), current vs previous window, with a per-status breakdown
  // and revenue. An order row only exists after the customer confirmed, so every row
  // here is a committed sale.
  // Wrapped so the Messaging tab still loads if the conversation_id migration
  // hasn't been applied yet (unknown-column → empty sales, not a 500).
  let salesRows = [];
  let salesConvRows = [{ n: 0 }];
  try {
    salesRows = await query(
      `SELECT (created_at >= ?) AS cur, status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS revenue, MAX(currency) AS currency
         FROM orders
        WHERE account_id = ? AND conversation_id IS NOT NULL AND created_at >= ?
        GROUP BY (created_at >= ?), status`,
      [curStart, accountId, prevStart, curStart],
    );
    // Distinct conversations that produced ≥1 sale in the current window — the
    // numerator for the conversation→sale conversion rate.
    salesConvRows = await query(
      `SELECT COUNT(DISTINCT conversation_id) AS n
         FROM orders
        WHERE account_id = ? AND conversation_id IS NOT NULL AND created_at >= ?`,
      [accountId, curStart],
    );
  } catch (e) {
    console.warn(`[analytics] attributed-sales query skipped: ${e?.message || e}`);
  }

  const pageRow = await query('SELECT account_name FROM platform_accounts WHERE id = ? LIMIT 1', [accountId]);

  const totalContacts = foldChannels(contactRows);
  const conversationsStarted = foldChannels(newRows);
  const retChannels = retCurRows
    .map((r) => ({ origin: r.origin, value: Number(r.n), changePct: null }))
    .filter((ch) => ch.value > 0)
    .sort((a, b) => b.value - a.value);
  const retTotal = retChannels.reduce((s, ch) => s + ch.value, 0);

  // Fold attributed sales into { total, changePct, revenue, currency, byStatus,
  // conversations, conversionRate }. byStatus is what "how many completed / processing
  // / cancelled" reads from; conversionRate = chats that sold ÷ contacts this period.
  let salesCur = 0;
  let salesPrev = 0;
  let revenueCur = 0;
  let salesCurrency = null;
  const statusMap = new Map();
  for (const r of salesRows) {
    const n = Number(r.n);
    if (Number(r.cur)) {
      salesCur += n;
      revenueCur += Number(r.revenue) || 0;
      salesCurrency = salesCurrency || r.currency;
      statusMap.set(r.status, (statusMap.get(r.status) || 0) + n);
    } else {
      salesPrev += n;
    }
  }
  const salesConversations = Number(salesConvRows[0]?.n || 0);
  const sales = {
    total: salesCur,
    changePct: changePct(salesCur, salesPrev),
    revenue: Math.round(revenueCur * 100) / 100,
    currency: salesCurrency || 'PHP',
    byStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    conversations: salesConversations,
    conversionRate: totalContacts.total > 0 ? Math.round((salesConversations / totalContacts.total) * 1000) / 10 : null,
  };

  return {
    rangeDays,
    pageName: pageRow[0]?.account_name ?? null,
    sinceDate: curStart,
    untilDate,
    totalContacts,
    conversationsStarted,
    // A new thread is a first-ever contact, so new contacts mirror conversations started.
    newContacts: { ...conversationsStarted },
    returningContacts: { total: retTotal, changePct: changePct(retTotal, Number(retPrevRows[0]?.n || 0)), channels: retChannels },
    sales,
    series: {
      totalContacts: fillDailySeries(contactSeriesRows, curStart, untilDate),
      conversationsStarted: fillDailySeries(startedSeriesRows, curStart, untilDate),
    },
  };
}

// ── Contents tab ──────────────────────────────────────────────────────────────
// Every published post for the ACTIVE page within the range, with its per-post
// engagement, for the Insights → Contents table. Purely app-side (reads the counts
// already warehoused on post_pool by the engagement sync) — no Meta call. Follows are
// page-level only on Facebook, so there is deliberately no per-post follows column.
export async function contentPerformance({ rangeDays = 28, accountId = null } = {}) {
  const now = Date.now();
  const untilDate = isoDay(now);
  const sinceDate = isoDay(now - rangeDays * DAY_MS);
  if (accountId == null) return { rangeDays, pageName: null, sinceDate, untilDate, posts: [] };

  const pageRow = await query('SELECT account_name FROM platform_accounts WHERE id = ? LIMIT 1', [accountId]);
  const rows = await query(
    `SELECT id, caption, media_type, thumbnail_s3_key, posted_at, platform_post_id,
            COALESCE(reactions_count, 0) AS reactions_count,
            COALESCE(comments_count, 0)  AS comments_count,
            COALESCE(shares_count, 0)    AS shares_count,
            COALESCE(views_count, 0)     AS views_count
       FROM post_pool
      WHERE account_id = ? AND status = 'posted' AND posted_at IS NOT NULL AND posted_at >= ?
      ORDER BY posted_at DESC
      LIMIT 200`,
    [accountId, sinceDate],
  );

  // Presign each thumbnail once (best-effort — a broken key just yields no image).
  const posts = await Promise.all(
    rows.map(async (p) => {
      let thumbnailUrl = null;
      if (p.thumbnail_s3_key) {
        try {
          thumbnailUrl = await createDownloadUrl(p.thumbnail_s3_key);
        } catch {
          thumbnailUrl = null;
        }
      }
      const reactions = Number(p.reactions_count);
      const comments = Number(p.comments_count);
      const shares = Number(p.shares_count);
      return {
        id: p.id,
        caption: p.caption,
        mediaType: p.media_type,
        thumbnailUrl,
        postedAt: p.posted_at,
        platformPostId: p.platform_post_id,
        views: Number(p.views_count),
        reactions,
        comments,
        shares,
        interactions: reactions + comments + shares,
      };
    }),
  );

  return { rangeDays, pageName: pageRow[0]?.account_name ?? null, sinceDate, untilDate, posts };
}
