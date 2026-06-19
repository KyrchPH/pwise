import api, { apiError } from './api.js';

export async function askWiseAssistant({ question, pathname, history }) {
  const { data } = await api.post('/wise-assistant/ask', {
    question,
    pathname,
    history,
  });
  return data.data; // { answer, source }
}

export { apiError };
