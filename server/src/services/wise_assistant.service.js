import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const MAX_QUESTION_LEN = 1200;
const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_TEXT_LEN = 700;

function normalizeQuestion(value) {
  const text = String(value ?? '').trim();
  if (!text) throw ApiError.badRequest('question is required');
  if (text.length > MAX_QUESTION_LEN) {
    throw ApiError.badRequest(`question is too long (max ${MAX_QUESTION_LEN} characters)`);
  }
  return text;
}

function normalizePathname(value) {
  const text = String(value ?? '').trim();
  if (!text) return '/';
  return text.slice(0, 255);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((entry) => ({
      role: entry?.role === 'user' ? 'user' : 'assistant',
      text: String(entry?.text ?? '')
        .trim()
        .slice(0, MAX_HISTORY_TEXT_LEN),
    }))
    .filter((entry) => entry.text);
}

function extractAssistantAnswer(body) {
  const obj = Array.isArray(body) ? body[0] : body;
  return (
    obj?.answer ||
    obj?.message ||
    obj?.reply ||
    obj?.data?.answer ||
    obj?.data?.message ||
    obj?.result?.answer ||
    null
  );
}

function ensureConfigured() {
  if (!env.n8n.wiseAssistantWebhookUrl) {
    throw new ApiError(503, 'Wise Assistant is disabled: N8N_WISE_ASSISTANT_WEBHOOK_URL is not configured on the server');
  }
}

export async function ask(user, { question, pathname = '/', history = [] } = {}) {
  ensureConfigured();

  const normalizedQuestion = normalizeQuestion(question);
  const normalizedPathname = normalizePathname(pathname);
  const normalizedHistory = normalizeHistory(history);

  const headers = {
    'Content-Type': 'application/json',
  };
  if (env.n8n.wiseAssistantSecret) headers['x-wise-assistant-secret'] = env.n8n.wiseAssistantSecret;
  if (env.n8n.webhookToken) headers['x-service-token'] = env.n8n.webhookToken;

  let response;
  try {
    response = await fetch(env.n8n.wiseAssistantWebhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: normalizedQuestion,
        pathname: normalizedPathname,
        history: normalizedHistory,
        user: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
            }
          : null,
        source: 'pwise-dev-overlay',
        requested_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ApiError(504, 'Wise Assistant timed out while waiting for n8n');
    }
    throw new ApiError(502, `couldn't reach the Wise Assistant workflow: ${error.message}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.message || body?.error || `Wise Assistant webhook error: ${response.statusText}`);
  }

  const answer = extractAssistantAnswer(body);
  if (!answer) {
    throw new ApiError(502, 'Wise Assistant workflow did not return an answer');
  }

  return {
    answer: String(answer).trim(),
    source: 'n8n',
  };
}
