import api, { apiError } from './api.js';

export async function askWiseAssistant({ question, pathname, history }) {
  const { data } = await api.post('/wise-assistant/ask', {
    question,
    pathname,
    history,
  });
  return data.data; // { answer, source }
}

// The signed-in user's saved Rovi conversation, for cross-device continuity.
export async function getWiseAssistantHistory() {
  const { data } = await api.get('/wise-assistant/history');
  return data.data.messages; // [{ role, text }]
}

export { apiError };
