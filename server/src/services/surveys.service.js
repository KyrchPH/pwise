import crypto from 'node:crypto';
import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/crypto.util.js';
import * as mail from './mail.service.js';

// Customer satisfaction surveys (CSAT + NPS). When an agent adds a note to a
// conversation — the app's "conversation completed" signal — maybeSendForConversation
// rolls an admin-configured per-page chance and may email the customer a two-question
// survey: how satisfied they are with how the agent handled the conversation (1-5)
// and how likely they are to recommend the company (NPS 0-10, promoter ≥9 /
// passive 7-8 / detractor ≤6).
//
// Two deliberate blind spots keep ratings honest:
//   · Sends are SILENT. Nothing is returned to the note author, no SSE event fires,
//     and no per-conversation flag is readable — an agent can never know whether a
//     given customer was surveyed.
//   · Stats are DAY-LAGGED. summary() only counts surveys sent before today, so the
//     team learns "N surveys went out yesterday" without being able to correlate a
//     send with a conversation they just closed.
//
// The customer's email comes from the order / agreement linked to the conversation
// (captured by the checkout delivery form). Messenger's Graph API does not expose a
// customer's email, so chat-only threads without an order simply never get surveyed;
// resolveCustomerEmail is the single place to add more sources later.

export const SURVEY_DEFAULTS = {
  enabled: false, // off until an admin opts the page in
  chancePct: 25, // % of eligible completions that get a survey
  cooldownDays: 30, // min days between surveys per conversation AND per email
};

const SURVEY_TTL_DAYS = 7; // how long the emailed link stays answerable
const MAX_COMMENT = 2000;

// Merge a stored (possibly null/partial) survey_config with defaults + sane bounds.
// Mirrors messaging_analytics.resolveConfig so platform_accounts can store it resolved.
export function resolveSurveyConfig(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  const c = parsed && typeof parsed === 'object' ? parsed : {};
  const chance = Number(c.chancePct);
  const cooldown = Number(c.cooldownDays);
  return {
    enabled: !!c.enabled,
    chancePct: Number.isFinite(chance) ? Math.min(100, Math.max(0, Math.round(chance))) : SURVEY_DEFAULTS.chancePct,
    cooldownDays: Number.isFinite(cooldown) && cooldown > 0 ? Math.min(365, Math.round(cooldown)) : SURVEY_DEFAULTS.cooldownDays,
  };
}

// Newest usable email attached to this conversation via the checkout flow: confirmed
// orders first (customer-verified), then agreements (drafted but maybe unconfirmed).
async function resolveCustomerEmail(conversationId) {
  const orders = await query(
    "SELECT email FROM orders WHERE conversation_id = ? AND email IS NOT NULL AND email <> '' ORDER BY id DESC LIMIT 1",
    [conversationId],
  );
  if (orders.length) return { email: orders[0].email, source: 'order' };
  const agreements = await query(
    "SELECT email FROM order_agreements WHERE conversation_id = ? AND email IS NOT NULL AND email <> '' ORDER BY id DESC LIMIT 1",
    [conversationId],
  );
  if (agreements.length) return { email: agreements[0].email, source: 'agreement' };
  return null;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function pageSurveySender(page = {}) {
  const email = String(page.survey_sender_email || '').trim();
  if (!email || !page.survey_sender_app_password) return null;
  const appPassword = decrypt(page.survey_sender_app_password);
  if (!appPassword) return null;
  return {
    email,
    appPassword,
    name: String(page.survey_sender_name || page.page_name || page.account_name || '').trim(),
  };
}

// A responsive, email-client-safe survey email (table layout + inline styles).
// The gold stars deep-link to the survey with a pre-selected satisfaction score
// (?csat=N — SurveyPage reads it), so a single tap starts them off on a rating.
export function surveyEmailHtml({ name, pageName, link, ttlDays }) {
  const safeName = escapeHtml(name);
  const safePage = escapeHtml(pageName);
  const initial = escapeHtml((String(pageName || '').trim().charAt(0) || '?').toUpperCase());
  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<td style="padding:0 4px;"><a href="${link}?csat=${n}" title="Rate ${n} of 5" style="text-decoration:none;color:#f6b100;font-size:34px;line-height:1;display:inline-block;">&#9733;</a></td>`,
    )
    .join('');
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>How did we do?</title>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef2f6;">It only takes a minute — tell ${safePage} how we did.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;">
    <tr><td align="center" style="padding:30px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 26px rgba(17,58,87,0.12);font-family:${font};">
        <tr><td style="background:#1f9be6;background:linear-gradient(135deg,#28a9f0 0%,#1275c4 100%);padding:32px 32px 28px;text-align:center;">
          <table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr>
            <td style="width:54px;height:54px;background:rgba(255,255,255,0.20);border-radius:50%;text-align:center;color:#ffffff;font-size:23px;font-weight:800;line-height:54px;">${initial}</td>
          </tr></table>
          <div style="margin-top:14px;color:#eaf6ff;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:700;">${safePage}</div>
          <div style="margin-top:5px;color:#ffffff;font-size:25px;font-weight:800;">How did we do?</div>
        </td></tr>
        <tr><td style="padding:30px 34px 6px;color:#2b3a46;">
          <p style="margin:0 0 14px;font-size:16px;">Hi ${safeName},</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a5b68;">Thanks for chatting with <strong style="color:#2b3a46;">${safePage}</strong>. We'd love to hear how it went — it takes less than a minute.</p>
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;"><tr>${stars}</tr></table>
          <div style="text-align:center;color:#94a3af;font-size:12px;margin-bottom:24px;">Tap a star to rate your experience</div>
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
            <td style="border-radius:11px;background:#1f9be6;background:linear-gradient(135deg,#28a9f0,#1275c4);box-shadow:0 4px 12px rgba(18,117,196,0.35);">
              <a href="${link}" style="display:inline-block;padding:15px 34px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:11px;">Rate your experience&nbsp;&rarr;</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 34px 0;text-align:center;">
          <div style="font-size:12px;color:#94a3af;margin-bottom:4px;">Button not working? Paste this link into your browser:</div>
          <a href="${link}" style="font-size:12px;color:#1f7fc0;word-break:break-all;">${link}</a>
        </td></tr>
        <tr><td style="padding:26px 34px 30px;">
          <div style="border-top:1px solid #edf1f5;margin-bottom:16px;"></div>
          <div style="text-align:center;color:#9aa8b4;font-size:12px;line-height:1.7;">This link is valid for ${ttlDays} days.<br>You're receiving this because you recently chatted with ${safePage}.</div>
        </td></tr>
      </table>
      <div style="max-width:520px;text-align:center;color:#aab6c1;font-size:11px;margin-top:16px;font-family:${font};">Sent by ${safePage}</div>
    </td></tr>
  </table>
</body></html>`;
}

async function sendSurveyEmail({ to, customerName, pageName, token, sender }) {
  const link = `${env.clientUrl}/survey/${token}`;
  const name = customerName || 'there';
  const subject = `How did we do? — ${pageName}`;
  const text = `Hi ${name},\n\nThanks for chatting with ${pageName}. We'd love your feedback — it takes less than a minute:\n\nRate your experience: ${link}\n\nThis link is valid for ${SURVEY_TTL_DAYS} days. Thank you!`;
  const html = surveyEmailHtml({ name, pageName, link, ttlDays: SURVEY_TTL_DAYS });
  try {
    await mail.sendMail({
      to,
      subject,
      text,
      html,
      ...(sender
        ? {
            smtp: {
              user: sender.email,
              pass: sender.appPassword,
              from: sender.email,
              fromName: sender.name || pageName,
            },
          }
        : {}),
    });
  } catch (err) {
    if (sender || mail.mailEnabled()) throw err; // SMTP configured but the send failed
    // Dev without SMTP: keep the flow testable, like the OTP mailer does.
    console.warn(`[surveys] SMTP not configured — survey link for ${to} is ${link}`);
  }
}

// The note-created hook. Fire-and-forget from conversation_notes.service — it must
// NEVER throw into the note flow and never reveal its outcome to the caller.
export async function maybeSendForConversation(conversationId, actor = {}) {
  const cid = Number(conversationId);
  if (!Number.isInteger(cid) || cid <= 0) return;

  const rows = await query(
    `SELECT c.id, c.account_id, c.customer_name, c.handled_by, c.assigned_user_id, c.assigned_user_name,
            p.account_name AS page_name, p.survey_config,
            p.survey_sender_email, p.survey_sender_name, p.survey_sender_app_password
       FROM conversations c
       JOIN platform_accounts p ON p.id = c.account_id
      WHERE c.id = ?`,
    [cid],
  );
  const conv = rows[0];
  if (!conv || conv.account_id == null) return;

  const cfg = resolveSurveyConfig(conv.survey_config);
  if (!cfg.enabled || cfg.chancePct <= 0) return;

  // The admin-defined chance: a plain lottery over eligible completions.
  if (Math.random() * 100 >= cfg.chancePct) return;

  const resolved = await resolveCustomerEmail(cid);
  if (!resolved) return; // no email on file → this thread can't be surveyed

  // Cooldown: never re-survey the same conversation or the same customer email
  // (page-scoped) within the window — repeated notes on one thread re-roll harmlessly.
  const recent = await query(
    `SELECT id FROM conversation_surveys
      WHERE (conversation_id = ? OR (account_id = ? AND email = ?))
        AND sent_at >= (NOW() - INTERVAL ? DAY)
      LIMIT 1`,
    [cid, conv.account_id, resolved.email, cfg.cooldownDays],
  );
  if (recent.length) return;

  // The rated agent: the thread's bound Live Agent when there is one, else the
  // note's author (they closed it, so it's their handling being rated).
  const agentId = conv.assigned_user_id ?? actor.id ?? null;
  const agentName = conv.assigned_user_name || actor.name || '';

  const token = crypto.randomBytes(20).toString('hex'); // 40 hex chars, like agreements
  await query(
    `INSERT INTO conversation_surveys
       (token, account_id, conversation_id, agent_user_id, agent_name, customer_name, email, email_source, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? DAY)`,
    [token, conv.account_id, cid, agentId, agentName, conv.customer_name || null, resolved.email, resolved.source, SURVEY_TTL_DAYS],
  );

  try {
    const sender = pageSurveySender(conv);
    await sendSurveyEmail({
      to: resolved.email,
      customerName: conv.customer_name,
      pageName: conv.page_name || 'our team',
      token,
      sender,
    });
  } catch (err) {
    // The email never left — drop the row so "surveys sent" counts only real sends.
    await query('DELETE FROM conversation_surveys WHERE token = ?', [token]).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public (tokenized, unauthenticated) survey endpoints — the customer side.
// ---------------------------------------------------------------------------

function surveyState(row) {
  if (row.responded_at) return 'submitted';
  if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
  return 'active';
}

async function findByToken(token) {
  const t = String(token || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(t)) throw ApiError.notFound('survey not found');
  const rows = await query(
    `SELECT s.*, p.account_name AS page_name
       FROM conversation_surveys s
       JOIN platform_accounts p ON p.id = s.account_id
      WHERE s.token = ?`,
    [t],
  );
  if (!rows.length) throw ApiError.notFound('survey not found');
  return rows[0];
}

// The survey shell for the public page. Deliberately minimal — page name only; no
// agent name, no conversation content.
export async function getPublic(token) {
  const row = await findByToken(token);
  return {
    state: surveyState(row),
    survey: {
      pageName: row.page_name || '',
      customerName: row.customer_name || '',
      expiresAt: row.expires_at,
    },
  };
}

// One-shot response submit. satisfaction 1-5 · recommend (NPS) 0-10 · optional comment.
export async function submitPublic(token, data = {}) {
  const row = await findByToken(token);
  const state = surveyState(row);
  if (state === 'submitted') throw new ApiError(409, 'this survey has already been answered');
  if (state === 'expired') throw new ApiError(410, 'this survey link has expired');

  const satisfaction = Number(data.satisfaction);
  const nps = Number(data.recommend);
  if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
    throw ApiError.badRequest('pick a satisfaction rating from 1 to 5');
  }
  if (!Number.isInteger(nps) || nps < 0 || nps > 10) {
    throw ApiError.badRequest('pick a recommendation score from 0 to 10');
  }
  const comment = String(data.comment ?? '').trim().slice(0, MAX_COMMENT) || null;

  // Guard the one-shot in SQL too, in case two submits race.
  const result = await query(
    'UPDATE conversation_surveys SET satisfaction = ?, nps = ?, comment = ?, responded_at = NOW() WHERE id = ? AND responded_at IS NULL',
    [satisfaction, nps, comment, row.id],
  );
  if (!result.affectedRows) throw new ApiError(409, 'this survey has already been answered');
  return { submitted: true };
}

// ---------------------------------------------------------------------------
// Admin "send test survey" (Settings → Customer surveys). The live flow is silent
// and day-lagged on purpose; a test is the opposite — fully OBSERVABLE — so an admin
// can confirm the pipe works end to end (SMTP → email → link → response tracking).
// Test rows carry is_test = 1 and conversation_id = NULL, and every summary() query
// filters is_test = 0, so a test never touches the honest CSAT/NPS aggregates.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function testSurveySender(raw = {}, page = {}) {
  const appPassword = String(raw.appPassword || '').trim();
  if (!appPassword) return null;
  const email = String(raw.email || '').trim();
  if (!EMAIL_RE.test(email)) throw ApiError.badRequest('enter a valid sender email before testing the app password');
  return {
    email,
    appPassword,
    name: String(raw.name || page.account_name || '').trim(),
  };
}

function shapeTest(row) {
  if (!row) return null;
  return {
    token: row.token,
    to: row.email,
    state: surveyState(row), // 'active' | 'submitted' | 'expired'
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
    satisfaction: row.satisfaction != null ? Number(row.satisfaction) : null,
    nps: row.nps != null ? Number(row.nps) : null,
    comment: row.comment || null,
  };
}

// Send a real survey email (flagged is_test) to `to` for this page. Returns the new
// test's observable status; when SMTP is unconfigured (dev) it also returns the raw
// link so the flow stays clickable locally, mirroring sendSurveyEmail's fallback.
export async function sendTest({ accountId, to, actor = {}, sender: senderOverride } = {}) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('select a page before sending a test survey');
  const email = String(to || '').trim();
  if (!EMAIL_RE.test(email)) throw ApiError.badRequest('enter a valid email address to send the test to');

  const rows = await query(
    'SELECT id, account_name, survey_sender_email, survey_sender_name, survey_sender_app_password FROM platform_accounts WHERE id = ?',
    [id],
  );
  const page = rows[0];
  if (!page) throw ApiError.notFound('page not found');
  const sender = testSurveySender(senderOverride, page) || pageSurveySender(page);

  const token = crypto.randomBytes(20).toString('hex');
  await query(
    `INSERT INTO conversation_surveys
       (token, account_id, conversation_id, agent_user_id, agent_name, customer_name, email, email_source, is_test, expires_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'test', 1, NOW() + INTERVAL ? DAY)`,
    [token, id, actor.id ?? null, actor.name || '', 'Test recipient', email, SURVEY_TTL_DAYS],
  );

  try {
    await sendSurveyEmail({
      to: email,
      customerName: actor.name || 'there',
      pageName: page.account_name || 'our team',
      token,
      sender,
    });
  } catch (err) {
    // Never leave a phantom test row if the send genuinely failed.
    await query('DELETE FROM conversation_surveys WHERE token = ?', [token]).catch(() => {});
    throw err;
  }

  const [row] = await query('SELECT * FROM conversation_surveys WHERE token = ?', [token]);
  const out = shapeTest(row);
  // Dev without SMTP: hand back the link so the admin can still click through. In
  // production mailEnabled() is true, so no capability URL is ever leaked to the client.
  if (!sender && !mail.mailEnabled()) out.devLink = `${env.clientUrl}/survey/${token}`;
  return out;
}

// The page's most recent test survey and its live (non-lagged) status, or null. Lets
// the settings UI show "waiting for response" → "responded" across reloads.
export async function latestTest({ accountId } = {}) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) return { test: null };
  const rows = await query(
    'SELECT * FROM conversation_surveys WHERE account_id = ? AND is_test = 1 ORDER BY id DESC LIMIT 1',
    [id],
  );
  return { test: shapeTest(rows[0]) };
}

// ---------------------------------------------------------------------------
// Team-facing aggregates (Insights → Messaging). DAY-LAGGED by design: every
// query is bounded by sent_at < CURDATE(), so today's sends stay invisible and
// surface tomorrow as "surveys sent yesterday".
// ---------------------------------------------------------------------------

export async function summary({ accountId, rangeDays = 28 }) {
  const id = Number(accountId);
  const days = Math.min(Math.max(Number(rangeDays) || 28, 1), 365);
  const empty = {
    rangeDays: days,
    sentYesterday: 0,
    sent: 0,
    responded: 0,
    responseRatePct: null,
    csat: { avg: null, sample: 0 },
    nps: { score: null, promoters: 0, passives: 0, detractors: 0, sample: 0 },
    series: [],
    comments: [],
  };
  if (!Number.isInteger(id) || id <= 0) return empty;

  const [totals] = await query(
    `SELECT
        COUNT(*) AS sent,
        SUM(sent_at >= (CURDATE() - INTERVAL 1 DAY)) AS sentYesterday,
        SUM(responded_at IS NOT NULL) AS responded,
        AVG(satisfaction) AS csatAvg,
        SUM(satisfaction IS NOT NULL) AS csatSample,
        SUM(nps >= 9) AS promoters,
        SUM(nps BETWEEN 7 AND 8) AS passives,
        SUM(nps <= 6) AS detractors,
        SUM(nps IS NOT NULL) AS npsSample
       FROM conversation_surveys
      WHERE account_id = ?
        AND is_test = 0
        AND sent_at < CURDATE()
        AND sent_at >= (CURDATE() - INTERVAL ? DAY)`,
    [id, days],
  );

  const sent = Number(totals.sent) || 0;
  const responded = Number(totals.responded) || 0;
  const npsSample = Number(totals.npsSample) || 0;
  const promoters = Number(totals.promoters) || 0;
  const detractors = Number(totals.detractors) || 0;

  // Surveys sent per day (day-lagged window) for the trend chart.
  const seriesRows = await query(
    `SELECT DATE_FORMAT(sent_at, '%Y-%m-%d') AS period, COUNT(*) AS value
       FROM conversation_surveys
      WHERE account_id = ?
        AND is_test = 0
        AND sent_at < CURDATE()
        AND sent_at >= (CURDATE() - INTERVAL ? DAY)
      GROUP BY period
      ORDER BY period ASC`,
    [id, days],
  );

  // Latest written feedback for the metrics report. Still day-lagged like
  // everything else; customer identity stays out of the team report.
  const commentRows = await query(
    `SELECT s.satisfaction, s.nps, s.comment, DATE_FORMAT(s.responded_at, '%Y-%m-%d') AS day,
            s.conversation_id AS conversationId, c.created_at AS conversationCreatedAt,
            COALESCE(NULLIF(s.agent_name, ''), c.assigned_user_name, c.handled_by, 'Unassigned') AS agentOwnerName,
            CASE
              WHEN s.conversation_id IS NULL THEN NULL
              WHEN c.created_at IS NULL THEN CONCAT('CID', s.conversation_id)
              ELSE CONCAT('CID', DATE_FORMAT(c.created_at, '%Y%m%d%H%i%s'), s.conversation_id)
            END AS conversationCid
       FROM conversation_surveys s
       LEFT JOIN conversations c ON c.id = s.conversation_id
      WHERE s.account_id = ?
        AND s.is_test = 0
        AND s.sent_at < CURDATE()
        AND s.sent_at >= (CURDATE() - INTERVAL ? DAY)
        AND s.responded_at IS NOT NULL
        AND s.comment IS NOT NULL AND s.comment <> ''
      ORDER BY s.responded_at DESC
      LIMIT 10`,
    [id, days],
  );

  return {
    rangeDays: days,
    sentYesterday: Number(totals.sentYesterday) || 0,
    sent,
    responded,
    responseRatePct: sent > 0 ? Math.round((responded / sent) * 100) : null,
    csat: {
      avg: totals.csatAvg == null ? null : Math.round(Number(totals.csatAvg) * 10) / 10,
      sample: Number(totals.csatSample) || 0,
    },
    nps: {
      score: npsSample > 0 ? Math.round(((promoters - detractors) / npsSample) * 100) : null,
      promoters,
      passives: Number(totals.passives) || 0,
      detractors,
      sample: npsSample,
    },
    series: seriesRows.map((r) => ({ period: r.period, value: Number(r.value) })),
    comments: commentRows.map((r) => ({
      satisfaction: r.satisfaction != null ? Number(r.satisfaction) : null,
      nps: r.nps != null ? Number(r.nps) : null,
      comment: r.comment,
      day: r.day,
      conversationId: r.conversationId != null ? Number(r.conversationId) : null,
      conversationCreatedAt: r.conversationCreatedAt || null,
      conversationCid: r.conversationCid || null,
      agentOwnerName: r.agentOwnerName || '',
    })),
  };
}
