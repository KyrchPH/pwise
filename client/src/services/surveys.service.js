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

// Admin: send a test survey (Settings → Customer surveys) to verify the pipe works.
// `to` blank → the server sends to the admin's own email. Returns { test } where test
// is { token, to, state, sentAt, respondedAt, satisfaction, nps, comment, devLink? }.
export async function sendTestSurvey({ to, accountId, sender } = {}) {
  const { data } = await api.post('/surveys/test', { to, accountId, sender });
  return data.data.test;
}

// Admin: the page's most recent test survey and its live status → { test } | { test: null }.
export async function getTestSurvey(accountId = null) {
  const params = accountId != null ? { accountId } : {};
  const { data } = await api.get('/surveys/test', { params });
  return data.data.test;
}
