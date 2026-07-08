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
