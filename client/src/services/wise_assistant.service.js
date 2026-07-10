import api, { apiError } from './api.js';

export async function askWiseAssistant({ question, pathname, history, context }) {
  const { data } = await api.post('/wise-assistant/ask', {
    question,
    pathname,
    history,
    // Where the user is + what they may reach: a REDACTED localStorage snapshot and
    // the routes this account can navigate to (see wiseAssistantActions.js).
    context,
  });
  return data.data; // { answer, actions, source }
}

// The signed-in user's saved Rovi conversation, for cross-device continuity.
export async function getWiseAssistantHistory() {
  const { data } = await api.get('/wise-assistant/history');
  return data.data.messages; // [{ role, text }]
}

export { apiError };
