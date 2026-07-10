import api from './api.js';

// Page analytics overview: { rangeDays, followers, pageName, series, ranking }.
// `series` is keyed by metric → [{ period: 'YYYY-MM-DD', value }]. Defaults to the
// caller's active page; pass `accountId` to scope it to a specific page instead.
export async function overview(range = 28, accountId = null) {
  const { data } = await api.get('/analytics/overview', {
    params: { range, ...(accountId != null ? { accountId } : {}) },
  });
  return data.data;
}

// Insights ("Performance") card model: { rangeDays, pageName, sinceDate, untilDate, cards }.
// Each card: { key, title, primary: { label, total, changePct, sparkline, available }, subs }.
export async function insights(range = 28) {
  const { data } = await api.get('/analytics/insights', { params: { range } });
  return data.data;
}

// All active connected pages in one report table:
// { rangeDays, sinceDate, untilDate, rows: [{ accountName, follows, unfollows, visits, currentFollowers }] }.
export async function allPagesMetrics(range = 28) {
  const { data } = await api.get('/analytics/all-pages-metrics', { params: { range } });
  return data.data;
}

// Insights "Overview" digest: { rangeDays, pageName, followers, sinceDate, untilDate,
// tiles, topPosts }. Each tile: { key, title, info, total, changePct, series, available }.
export async function highlights(range = 28) {
  const { data } = await api.get('/analytics/highlights', { params: { range } });
  return data.data;
}

// Messaging ("Contacts") model: { rangeDays, pageName, sinceDate, untilDate,
// totalContacts, conversationsStarted, newContacts, returningContacts, series }.
// Each metric: { total, changePct, channels: [{ origin, value, changePct }] }.
// `series` is { totalContacts, conversationsStarted } → [{ period, value }].
export async function messaging(range = 28) {
  const { data } = await api.get('/analytics/messaging', { params: { range } });
  return data.data;
}

// Contents ("Contents") tab: published posts for the active page within the range with
// per-post engagement. Returns { rangeDays, pageName, sinceDate, untilDate, posts }, where
// each post is { id, caption, mediaType, thumbnailUrl, postedAt, platformPostId, views,
// reactions, comments, shares, interactions }.
export async function contents(range = 28) {
  const { data } = await api.get('/analytics/contents', { params: { range } });
  return data.data;
}
