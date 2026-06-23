import { query } from '../config/db.js';

// Live-agent (human) response metrics for the Messaging page — the Shopee-seller
// model, measured for HUMAN agents only (the AI's auto-replies don't count):
//
//   CRR — Chat Response Rate: of the customer "turns" a human owed a reply, the % a
//         live agent answered within the CRR window (default 12h).
//   FRT — First Response Time: avg time to the FIRST live-agent reply per conversation.
//   ART — Average Response Time: avg time across ALL live-agent replies.
//
// A customer "turn" is a run of consecutive incoming messages; it's attributed to
// whoever replied next — so turns the AI answered are excluded from these human
// metrics. FRT/ART are surfaced as a 0–100% score vs a target time (100% = at or
// under target). All thresholds are per-page configurable (platform_accounts
// .analytics_config); blanks fall back to ANALYTICS_DEFAULTS.

export const ANALYTICS_DEFAULTS = {
  periodDays: 7, // measurement window
  crrWindowHours: 12, // "responded within" threshold for CRR (Shopee uses 12h)
  frtTargetSeconds: 300, // 5 min — full ring for First Response Time
  artTargetSeconds: 300, // 5 min — full ring for Average Response Time
};

// A live-agent (human) reply is an outgoing message NOT sent by the AI. Human replies
// are written by messaging.sendMessage with sender = the agent's name; AI replies come
// through receiveInbound with sender = 'AI Agent'. (See messaging.service.js.)
const AI_SENDER = 'AI Agent';

// Clamp + default a single numeric config value.
function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Merge a stored (possibly null/partial) config with the defaults + sane bounds.
export function resolveConfig(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  const c = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    periodDays: num(c.periodDays, ANALYTICS_DEFAULTS.periodDays, 1, 365),
    crrWindowHours: num(c.crrWindowHours, ANALYTICS_DEFAULTS.crrWindowHours, 1, 24 * 30),
    frtTargetSeconds: num(c.frtTargetSeconds, ANALYTICS_DEFAULTS.frtTargetSeconds, 5, 24 * 3600),
    artTargetSeconds: num(c.artTargetSeconds, ANALYTICS_DEFAULTS.artTargetSeconds, 5, 24 * 3600),
  };
}

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
// Score a duration against a target: 100% when at/under target, scaling down as it
// gets slower. null avg (no data) → null score.
const scoreVsTarget = (avgSec, targetSec) =>
  avgSec == null ? null : avgSec <= targetSec ? 100 : Math.max(0, Math.round((100 * targetSec) / avgSec));

// Compute the three metrics for one page over its configured window. Always returns
// a full shape (values null when there's no data). Never trusts the LLM — the page
// scope comes from the caller.
export async function computeAgentMetrics(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const cfgRows = await query('SELECT analytics_config FROM platform_accounts WHERE id = ?', [id]);
  if (!cfgRows.length) return null;
  const cfg = resolveConfig(cfgRows[0].analytics_config);

  // One DB clock reading so "overdue" comparisons don't drift against the app's TZ.
  const nowRows = await query('SELECT NOW() AS now');
  const nowMs = new Date(nowRows[0].now).getTime();
  const crrWindowMs = cfg.crrWindowHours * 3600_000;

  // Messages for this page within the window, oldest-first per conversation. handled_by
  // tells us whether an unanswered turn is a human's responsibility (Live Agent) or the
  // AI's (then it's out of scope here).
  const rows = await query(
    `SELECT m.conversation_id AS cid, m.side AS side, m.sender AS sender, m.created_at AS ts, c.handled_by AS handledBy
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = ?
        AND m.created_at >= (NOW() - INTERVAL ? DAY)
      ORDER BY m.conversation_id ASC, m.created_at ASC, m.id ASC
      LIMIT 50000`,
    [id, cfg.periodDays],
  );

  // Group messages by conversation (already globally ordered, so per-conversation order holds).
  const byConv = new Map();
  for (const r of rows) {
    let g = byConv.get(r.cid);
    if (!g) {
      g = { handledBy: r.handledBy, msgs: [] };
      byConv.set(r.cid, g);
    }
    g.msgs.push(r);
  }

  let answeredWithin = 0; // human replied within the CRR window
  let answeredTotal = 0; // human replied (any time) — within + late
  let missedOverdue = 0; // human owns the chat but hasn't replied, and it's past the window
  const frtSecs = []; // first human-answered turn per conversation
  const artSecs = []; // every human-answered turn

  for (const { handledBy, msgs } of byConv.values()) {
    let i = 0;
    let firstHumanForConv = true;
    while (i < msgs.length) {
      if (msgs[i].side !== 'incoming') {
        i += 1;
        continue;
      }
      // Start of a customer turn: collapse consecutive incoming into one.
      const turnStart = new Date(msgs[i].ts).getTime();
      let j = i;
      while (j < msgs.length && msgs[j].side === 'incoming') j += 1;

      if (j < msgs.length) {
        // msgs[j] is the first reply after the turn.
        const out = msgs[j];
        const isHuman = out.side === 'outgoing' && out.sender !== AI_SENDER;
        if (isHuman) {
          const dt = (new Date(out.ts).getTime() - turnStart) / 1000;
          if (dt >= 0) {
            artSecs.push(dt);
            if (firstHumanForConv) {
              frtSecs.push(dt);
              firstHumanForConv = false;
            }
            answeredTotal += 1;
            if (dt * 1000 <= crrWindowMs) answeredWithin += 1;
          }
        }
        // AI-answered turn → out of scope for human metrics; skip.
      } else if (handledBy === 'Live Agent' && nowMs - turnStart > crrWindowMs) {
        // No reply at all and a human owns the chat past the window → a missed chat.
        missedOverdue += 1;
      }
      i = j; // continue scanning after the turn
    }
  }

  const crrDenom = answeredTotal + missedOverdue;
  const frtAvg = avg(frtSecs);
  const artAvg = avg(artSecs);

  return {
    crr: {
      pct: crrDenom > 0 ? Math.round((answeredWithin / crrDenom) * 100) : null,
      sample: crrDenom,
    },
    frt: {
      seconds: frtAvg == null ? null : Math.round(frtAvg),
      scorePct: scoreVsTarget(frtAvg, cfg.frtTargetSeconds),
      sample: frtSecs.length,
    },
    art: {
      seconds: artAvg == null ? null : Math.round(artAvg),
      scorePct: scoreVsTarget(artAvg, cfg.artTargetSeconds),
      sample: artSecs.length,
    },
    config: cfg,
  };
}
