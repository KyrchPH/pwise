import api from './api.js';

// Page analytics overview: { rangeDays, followers, pageName, series, ranking }.
// `series` is keyed by metric → [{ period: 'YYYY-MM-DD', value }].
export async function overview(range = 28) {
  const { data } = await api.get('/analytics/overview', { params: { range } });
  return data.data;
}
