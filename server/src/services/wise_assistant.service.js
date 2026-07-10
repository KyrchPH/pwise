import { env } from '../config/env.js';
import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { signAssistantToken } from './auth.service.js';

const MAX_QUESTION_LEN = 1200;
const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_TEXT_LEN = 700;
// Cap the per-user conversation we keep server-side (the intro greeting is added
// back client-side, so it's never stored).
const MAX_STORED_MESSAGES = 50;

// ── Client actions the assistant may request ─────────────────────────────────
// n8n's answer can carry an `actions` array the browser executes (navigate, reload,
// read localStorage, fill/toggle a control). The LLM output is untrusted, so the
// server is the trust boundary: everything is validated against this allowlist
// before it reaches the client, and the client re-checks module/admin access again
// before acting (its route guards are the final backstop).
const MAX_ACTIONS = 5;
const UI_OPS = new Set(['fill', 'toggle', 'click']);
const THEME_VALUES = new Set(['dark', 'light', 'toggle']);
const NOTES_OPS = new Set(['show', 'hide', 'toggle']);
const SIDEBAR_OPS = new Set(['collapse', 'expand', 'toggle']);
const PIN_OPS = new Set(['pin', 'unpin', 'toggle']);
const MAX_TARGET_LEN = 160;
// Mirrors the client's NAVIGABLE_ROUTES (client/src/utils/wiseAssistantActions.js).
const NAVIGABLE_PATHS = new Set([
  '/dashboard',
  '/content-calendar',
  '/planner',
  '/analytics',
  '/insights',
  '/post-pool',
  '/upload',
  '/shop',
  '/shop/products',
  '/shop/discounts',
  '/shop/orders',
  '/shop/receipts',
  '/settings',
  '/logs',
  '/activity',
  '/accounts',
  '/messages',
  '/connections',
  '/vault',
  '/profile',
  '/profile/change-password',
  '/privacy',
]);

// Caps for the client-supplied context that gets forwarded into the prompt.
const MAX_STORAGE_ITEMS = 40;
const MAX_STORAGE_KEY_LEN = 120;
const MAX_STORAGE_VALUE_LEN = 300;
const MAX_ALLOWED_PATHS = 64;

// Load a user's saved Rovi conversation ([{ role, text }], oldest first). Empty when
// none. Tolerates a JSON column returned as a string.
export async function getHistory(user) {
  if (!user?.id) return [];
  const rows = await query('SELECT messages FROM wise_assistant_chats WHERE user_id = ?', [user.id]);
  if (!rows.length) return [];
  const raw = rows[0].messages;
  const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
  return Array.isArray(arr)
    ? arr.filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'agent'))
    : [];
}

// Append exchanges to a user's saved conversation (capped). Upsert one row per user.
async function appendHistory(userId, entries) {
  if (!userId || !entries.length) return;
  const rows = await query('SELECT messages FROM wise_assistant_chats WHERE user_id = ?', [userId]);
  let current = [];
  if (rows.length) {
    const raw = rows[0].messages;
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    if (Array.isArray(arr)) current = arr;
  }
  const next = [...current, ...entries].slice(-MAX_STORED_MESSAGES);
  await query(
    'INSERT INTO wise_assistant_chats (user_id, messages) VALUES (?, ?) ON DUPLICATE KEY UPDATE messages = VALUES(messages)',
    [userId, JSON.stringify(next)],
  );
}

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

// The overlay sends a small "where the user is" context: a REDACTED localStorage
// snapshot (the client masks token-ish values before they leave the browser) and the
// routes this user may navigate to. Size-cap everything — it goes into an LLM prompt.
function normalizeClientContext(context) {
  if (!context || typeof context !== 'object') return null;
  const out = {};

  if (Array.isArray(context.storage)) {
    out.storage = context.storage
      .slice(0, MAX_STORAGE_ITEMS)
      .map((entry) => ({
        key: String(entry?.key ?? '').slice(0, MAX_STORAGE_KEY_LEN),
        value: String(entry?.value ?? '').slice(0, MAX_STORAGE_VALUE_LEN),
      }))
      .filter((entry) => entry.key);
  }

  if (Array.isArray(context.allowed_paths)) {
    out.allowed_paths = context.allowed_paths
      .slice(0, MAX_ALLOWED_PATHS)
      .map((entry) => ({
        path: String(entry?.path ?? '').slice(0, 120),
        label: String(entry?.label ?? '').slice(0, 80),
      }))
      .filter((entry) => entry.path.startsWith('/'));
  }

  if (context.page_title) out.page_title = String(context.page_title).slice(0, 200);
  return Object.keys(out).length ? out : null;
}

// Validate the LLM-proposed actions down to the exact shapes the client executor
// understands. Anything unrecognized is silently dropped — a malformed action must
// never break an otherwise-good answer.
export function sanitizeActions(raw) {
  if (!Array.isArray(raw)) return [];
  const actions = [];
  for (const entry of raw) {
    if (actions.length >= MAX_ACTIONS) break;
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'navigate') {
      const path = String(entry.path ?? '').trim();
      if (NAVIGABLE_PATHS.has(path)) actions.push({ type: 'navigate', path });
    } else if (entry.type === 'reload') {
      actions.push({ type: 'reload' });
    } else if (entry.type === 'read_storage') {
      const key = String(entry.key ?? '').trim().slice(0, MAX_STORAGE_KEY_LEN);
      actions.push(key ? { type: 'read_storage', key } : { type: 'read_storage' });
    } else if (entry.type === 'ui') {
      const op = String(entry.op ?? '').trim();
      const target = String(entry.target ?? '').trim().slice(0, MAX_TARGET_LEN);
      if (!UI_OPS.has(op) || !target) continue;
      const action = { type: 'ui', op, target };
      if (op === 'fill') action.value = String(entry.value ?? '').slice(0, 500);
      actions.push(action);
    } else if (entry.type === 'theme') {
      const value = String(entry.value ?? 'toggle').trim();
      actions.push({ type: 'theme', value: THEME_VALUES.has(value) ? value : 'toggle' });
    } else if (entry.type === 'notes') {
      const op = String(entry.op ?? entry.value ?? 'toggle').trim();
      actions.push({ type: 'notes', op: NOTES_OPS.has(op) ? op : 'toggle' });
    } else if (entry.type === 'sidebar') {
      const op = String(entry.op ?? entry.value ?? 'toggle').trim();
      actions.push({ type: 'sidebar', op: SIDEBAR_OPS.has(op) ? op : 'toggle' });
    } else if (entry.type === 'pin') {
      const op = String(entry.op ?? entry.value ?? 'toggle').trim();
      const target = String(entry.target ?? '').trim().slice(0, MAX_TARGET_LEN);
      if (!target) continue; // the client needs a sidebar item to resolve
      actions.push({ type: 'pin', op: PIN_OPS.has(op) ? op : 'toggle', target });
    } else if (entry.type === 'page') {
      // Switching the active Facebook page — the client matches the name against
      // the user's own connected pages, so it stays user-scoped.
      const target = String(entry.target ?? '').trim().slice(0, MAX_TARGET_LEN);
      if (!target) continue;
      actions.push({ type: 'page', target });
    }
  }
  return actions;
}

function extractAssistantPayload(body) {
  const obj = Array.isArray(body) ? body[0] : body;
  const answer =
    obj?.answer ||
    obj?.message ||
    obj?.reply ||
    obj?.data?.answer ||
    obj?.data?.message ||
    obj?.result?.answer ||
    null;
  const actions = obj?.actions ?? obj?.data?.actions ?? obj?.result?.actions ?? null;
  return { answer, actions };
}

function ensureConfigured() {
  if (!env.n8n.wiseAssistantWebhookUrl) {
    throw new ApiError(503, 'Wise Assistant is disabled: N8N_WISE_ASSISTANT_WEBHOOK_URL is not configured on the server');
  }
}

export async function ask(user, sessionId, { question, pathname = '/', history = [], context = null } = {}) {
  ensureConfigured();

  const normalizedQuestion = normalizeQuestion(question);
  const normalizedPathname = normalizePathname(pathname);
  const normalizedHistory = normalizeHistory(history);
  const clientContext = normalizeClientContext(context);

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
              module_access: user.module_access ?? null,
            }
          : null,
        client_context: clientContext,
        // The workflow's read-only data tool: a 10-minute assistant-scoped JWT tied
        // to the caller's session, plus where to call. requireAuth blocks any
        // mutation attempted with it, so the agent can only READ this user's data.
        assistant_api:
          user && sessionId
            ? {
                base_url: env.n8n.wiseAssistantApiBase,
                token: signAssistantToken(user, sessionId),
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

  const { answer, actions } = extractAssistantPayload(body);
  if (!answer) {
    throw new ApiError(502, 'Wise Assistant workflow did not return an answer');
  }

  const cleanAnswer = String(answer).trim();
  const cleanActions = sanitizeActions(actions);

  // Persist this exchange so the conversation follows the user across devices.
  // Best-effort — a storage hiccup must not fail an otherwise-good answer.
  try {
    await appendHistory(user?.id, [
      { role: 'user', text: normalizedQuestion },
      { role: 'agent', text: cleanAnswer },
    ]);
  } catch (e) {
    console.warn(`[wise-assistant] couldn't persist chat history: ${e?.message || e}`);
  }

  return {
    answer: cleanAnswer,
    actions: cleanActions,
    source: 'n8n',
  };
}
