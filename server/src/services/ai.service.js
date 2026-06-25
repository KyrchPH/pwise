import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

// Direct OpenAI helper for in-app AI features that DON'T route through n8n. Currently
// the messaging composer's "Enhance" button: polish a live agent's draft reply.

const ENHANCE_SYSTEM = [
  "You polish a customer-support agent's DRAFT reply before they send it.",
  'Rewrite it to be clear, friendly, and professional — fix grammar, spelling, and awkward phrasing.',
  'STRICT rules:',
  '- Preserve the original meaning, facts, names, numbers, prices, and any links exactly.',
  "- Keep the SAME language and style (e.g. if it's Taglish, stay Taglish — do not translate).",
  '- Do NOT add new information, greetings, or sign-offs that were not there, and do NOT answer for the agent.',
  '- Return ONLY the rewritten message text — no quotes, labels, or commentary.',
].join('\n');

// Improve a draft reply. Returns { text }. Throws ApiError on bad input / missing
// config / upstream failure (the controller surfaces the message to the agent).
export async function enhanceText(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) throw ApiError.badRequest('text is required');
  if (text.length > 4000) throw ApiError.badRequest('that message is too long to enhance');
  if (!env.openai.apiKey) {
    throw new ApiError(503, 'AI enhance is not configured on the server (OPENAI_API_KEY missing).');
  }

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.openai.apiKey}` },
      body: JSON.stringify({
        model: env.openai.enhanceModel,
        messages: [
          { role: 'system', content: ENHANCE_SYSTEM },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(504, 'AI enhance timed out — please try again.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[ai] enhance failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
    throw new ApiError(502, 'AI enhance is unavailable right now — please try again.');
  }
  const data = await res.json().catch(() => null);
  const out = data?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new ApiError(502, 'AI enhance returned an empty result.');
  return { text: out };
}
