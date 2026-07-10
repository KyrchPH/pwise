import api from './api.js';

// Customer satisfaction surveys (CSAT + NPS). The public pair backs the unauthenticated
// /survey/:token page the customer opens from the survey email; summary feeds the
// Insights → Messaging card. Summary data is day-lagged by design: the server only
// counts surveys sent before today, so agents can't correlate a send with a chat
// they just closed.

// Public: fetch the survey shell (or its end-state) for the token link.
export async function getPublicSurvey(token) {
  const { data } = await api.get(`/public/surveys/${token}`);
  return data.data;
}

// Public: one-shot answer submit — { satisfaction: 1-5, recommend: 0-10, comment? }.
export async function submitPublicSurvey(token, payload) {
  const { data } = await api.post(`/public/surveys/${token}/respond`, payload);
  return data.data;
}

// Team-facing aggregates for the active page: { rangeDays, sentYesterday, sent,
// responded, responseRatePct, csat: { avg, sample }, nps: { score, promoters,
// passives, detractors, sample }, series, comments }.
export async function summary(range = 28, accountId = null) {
  const params = { range };
  if (accountId != null) params.accountId = accountId;
  const { data } = await api.get('/surveys/summary', { params });
  return data.data;
}
