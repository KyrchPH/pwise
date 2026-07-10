import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { fetchPageProfile } from './fb.service.js';
import { getDecrypted } from './platform_accounts.service.js';
import { isAdminRole } from '../config/modules.js';
import { areConnected } from './connections.service.js';

// Planner. Goals live inside a PLAN — a named container with its own membership.
// A user sees a plan only if they're a member (admins bypass); each member has a
// role: viewer (see goals) < editor (edit goal details) < owner (add/delete goals
// and manage the plan + members). The creator is auto-added as an owner.
//
// Progress is measured as GROWTH WITHIN a goal's [start_date, end_date]:
//   - posts → contents PUBLISHED in the range: pool posts + Stories.
//   - comments/shares/views/reactions → aggregated over pool posts in the range.
//   - followers → net gained since the goal was created (baseline captured at creation).
//   - sales → SUM(orders.total) for the page in the range (cancelled excluded).
//   - promoters/neutral/detractors → NPS survey responses in the range, bucketed
//     by score (>=9 / 7-8 / <=6) — the same buckets surveys.service.js uses.
// status/completed_at are persisted terminal states, reconciled on read.

export const METRICS = [
  'followers', 'posts', 'comments', 'shares', 'views', 'reactions',
  'sales', 'promoters', 'neutral', 'detractors',
];
export const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
export const PLAN_ROLES = ['viewer', 'editor', 'owner'];

// Metric → the post_pool column summed for it. Fixed whitelist (never interpolate user input).
const ENGAGEMENT_COLUMN = {
  comments: 'comments_count',
  shares: 'shares_count',
  views: 'views_count',
  reactions: 'reactions_count',
};

// NPS metric → the fixed score-bucket predicate (constant strings, not user input).
const NPS_BUCKET = {
  promoters: 'nps >= 9',
  neutral: 'nps BETWEEN 7 AND 8',
  detractors: 'nps <= 6',
};

// Explicit column list so DATE columns come back as clean 'YYYY-MM-DD' strings
// (avoids mysql2's Date-object timezone drift on DATE types).
const COLS = `
  id, account_id, plan_id, created_by, title, metric, period, target_value, baseline_value,
  DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(end_date,   '%Y-%m-%d') AS end_date,
  status, completed_at, created_at, updated_at`;

// ── Plans: access + listing ────────────────────────────────────────────────

// A user's role on a plan: 'owner' | 'editor' | 'viewer' | null (no access).
// Admins get 'owner' on every existing plan. Returns null for a missing plan too.
export async function getPlanRole(user, planId) {
  const id = Number(planId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const exists = await query('SELECT id FROM planner_plans WHERE id = ?', [id]);
  if (!exists.length) return null;
  if (isAdminRole(user?.role)) return 'owner';
  const rows = await query(
    'SELECT role FROM planner_plan_members WHERE plan_id = ? AND user_id = ?',
    [id, user?.id ?? 0],
  );
  return rows.length ? rows[0].role : null;
}

// All plans visible to the user, each hydrated with members, enriched goals and a
// summary. One batched goals query keeps the follower-Graph calls de-duplicated.
export async function listPlans(user) {
  const admin = isAdminRole(user?.role);
  const plans = admin
    ? await query('SELECT id, name, description, created_by, created_at, updated_at FROM planner_plans ORDER BY created_at ASC, id ASC')
    : await query(
        `SELECT p.id, p.name, p.description, p.created_by, p.created_at, p.updated_at
           FROM planner_plans p
           JOIN planner_plan_members m ON m.plan_id = p.id AND m.user_id = ?
          ORDER BY p.created_at ASC, p.id ASC`,
        [user?.id ?? 0],
      );
  if (!plans.length) return { plans: [] };

  const ids = plans.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const [memberRows, goalRows] = await Promise.all([
    query(
      `SELECT m.plan_id, m.role, u.id AS uid, u.name, u.email
         FROM planner_plan_members m JOIN users u ON u.id = m.user_id
        WHERE m.plan_id IN (${placeholders})
        ORDER BY (m.role = 'owner') DESC, u.name ASC, u.email ASC`,
      ids,
    ),
    query(`SELECT ${COLS} FROM planner_goals WHERE plan_id IN (${placeholders}) ORDER BY created_at DESC`, ids),
  ]);
  const enriched = await enrichGoals(goalRows);

  const membersByPlan = new Map();
  const myRoleByPlan = new Map();
  for (const r of memberRows) {
    if (!membersByPlan.has(r.plan_id)) membersByPlan.set(r.plan_id, []);
    membersByPlan.get(r.plan_id).push(toMember(r));
    if (Number(r.uid) === Number(user?.id)) myRoleByPlan.set(r.plan_id, r.role);
  }
  const goalsByPlan = new Map();
  for (const g of enriched) {
    if (!goalsByPlan.has(g.plan_id)) goalsByPlan.set(g.plan_id, []);
    goalsByPlan.get(g.plan_id).push(g);
  }

  return {
    plans: plans.map((p) => {
      const goals = goalsByPlan.get(p.id) || [];
      return {
        ...shapePlan(p),
        role: admin ? 'owner' : (myRoleByPlan.get(p.id) || 'viewer'),
        members: membersByPlan.get(p.id) || [],
        goals,
        summary: summarize(goals),
      };
    }),
  };
}

export async function getPlan(user, planId) {
  const role = await getPlanRole(user, planId);
  if (!role) throw ApiError.notFound('plan not found');
  const rows = await query('SELECT id, name, description, created_by, created_at, updated_at FROM planner_plans WHERE id = ?', [planId]);
  return hydrateOnePlan(rows[0], role);
}

export async function createPlan(user, body = {}) {
  const name = cleanPlanName(body.name);
  const description = cleanPlanDescription(body.description);
  const members = await validateMembers(user, body.members); // connection-checked

  const res = await query(
    'INSERT INTO planner_plans (name, description, created_by) VALUES (?, ?, ?)',
    [name, description, user?.id ?? null],
  );
  const planId = res.insertId;
  await query('INSERT INTO planner_plan_members (plan_id, user_id, role) VALUES (?, ?, ?)', [planId, user.id, 'owner']);
  for (const m of members) {
    await query(
      'INSERT INTO planner_plan_members (plan_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)',
      [planId, m.user_id, m.role],
    );
  }
  return getPlan(user, planId);
}

export async function updatePlan(user, planId, body = {}) {
  await requireOwner(user, planId, 'edit this plan');
  const patch = {};
  if ('name' in body) patch.name = cleanPlanName(body.name);
  if ('description' in body) patch.description = cleanPlanDescription(body.description);
  const keys = Object.keys(patch);
  if (keys.length) {
    await query(
      `UPDATE planner_plans SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => patch[k]), planId],
    );
  }
  return getPlan(user, planId);
}

export async function deletePlan(user, planId) {
  await requireOwner(user, planId, 'delete this plan');
  await query('DELETE FROM planner_plans WHERE id = ?', [planId]); // cascades goals + members
  return { id: Number(planId), deleted: true };
}

// ── Plan membership ─────────────────────────────────────────────────────────

export async function addMember(user, planId, body = {}) {
  await requireOwner(user, planId, 'manage members');
  const uid = Number(body.user_id);
  if (!Number.isInteger(uid) || uid <= 0) throw ApiError.badRequest('Select someone to share with.');
  if (uid === Number(user.id)) throw ApiError.badRequest('You already own this plan.');
  if (!(await areConnected(user.id, uid))) throw ApiError.badRequest('You can only share with people in your connections.');
  const role = cleanRole(body.role);
  await query(
    'INSERT INTO planner_plan_members (plan_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)',
    [planId, uid, role],
  );
  return getPlan(user, planId);
}

export async function setMemberRole(user, planId, userId, body = {}) {
  await requireOwner(user, planId, 'manage members');
  const uid = Number(userId);
  const role = cleanRole(body.role);
  const existing = await query('SELECT role FROM planner_plan_members WHERE plan_id = ? AND user_id = ?', [planId, uid]);
  if (!existing.length) throw ApiError.notFound('That person is not a member of this plan.');
  // Never leave a plan without an owner.
  if (existing[0].role === 'owner' && role !== 'owner' && (await ownerCount(planId)) <= 1) {
    throw ApiError.badRequest('A plan must keep at least one owner.');
  }
  await query('UPDATE planner_plan_members SET role = ? WHERE plan_id = ? AND user_id = ?', [role, planId, uid]);
  return getPlan(user, planId);
}

export async function removeMember(user, planId, userId) {
  await requireOwner(user, planId, 'manage members');
  const uid = Number(userId);
  const existing = await query('SELECT role FROM planner_plan_members WHERE plan_id = ? AND user_id = ?', [planId, uid]);
  if (!existing.length) return getPlan(user, planId);
  if (existing[0].role === 'owner' && (await ownerCount(planId)) <= 1) {
    throw ApiError.badRequest('A plan must keep at least one owner.');
  }
  await query('DELETE FROM planner_plan_members WHERE plan_id = ? AND user_id = ?', [planId, uid]);
  return getPlan(user, planId);
}

// The acting user's accepted connections — the pool the share picker draws from.
export async function listShareCandidates(user) {
  const rows = await query(
    `SELECT u.id AS uid, u.name, u.email
       FROM user_connections c
       JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END
      WHERE c.status = 'accepted' AND (c.requester_id = ? OR c.addressee_id = ?)
        AND u.is_active = 1 AND u.deleted_at IS NULL
      ORDER BY u.name ASC, u.email ASC`,
    [user.id, user.id, user.id],
  );
  return rows.map((r) => ({ id: Number(r.uid), name: r.name || r.email || 'User', email: r.email || '' }));
}

// ── Goals (plan-scoped, role-gated) ─────────────────────────────────────────

export async function createGoal(user, planId, body = {}) {
  await requireOwner(user, planId, 'add goals'); // owner adds goals
  const data = await validateCreate(body);
  const baseline = data.metric === 'followers' ? await captureFollowerCount(data.account_id) : null;
  const result = await query(
    `INSERT INTO planner_goals
       (account_id, plan_id, created_by, title, metric, period, target_value, baseline_value, start_date, end_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ongoing')`,
    [data.account_id, Number(planId), user?.id ?? null, data.title, data.metric, data.period, data.target_value, baseline, data.start_date, data.end_date],
  );
  return getById(result.insertId);
}

export async function updateGoal(user, goalId, body = {}) {
  const existing = await getRawRow(goalId); // 404 if missing
  const role = await getPlanRole(user, existing.plan_id);
  if (!role) throw ApiError.notFound('goal not found');
  if (role !== 'owner' && role !== 'editor') throw ApiError.forbidden('You do not have permission to edit this goal.');

  const patch = await validateUpdate(body, existing);
  const finalMetric = patch.metric ?? existing.metric;
  const finalAccount = patch.account_id ?? existing.account_id;
  if (finalMetric === 'followers') {
    if (patch.metric === 'followers' || existing.baseline_value == null) {
      const baseline = await captureFollowerCount(finalAccount);
      if (baseline != null) patch.baseline_value = baseline;
    }
  } else if (existing.metric === 'followers') {
    patch.baseline_value = null; // switched away from followers → drop the stale baseline
  }

  const keys = Object.keys(patch);
  if (keys.length) {
    const assignments = keys.map((k) => `${k} = ?`);
    const params = keys.map((k) => patch[k]);
    assignments.push("status = 'ongoing'", 'completed_at = NULL'); // any edit re-opens reconciliation
    params.push(goalId);
    await query(`UPDATE planner_goals SET ${assignments.join(', ')} WHERE id = ?`, params);
  }
  return getById(goalId);
}

export async function removeGoal(user, goalId) {
  const existing = await getRawRow(goalId); // 404 if missing
  const role = await getPlanRole(user, existing.plan_id);
  if (!role) throw ApiError.notFound('goal not found');
  if (role !== 'owner') throw ApiError.forbidden('Only an owner can delete goals.');
  await query('DELETE FROM planner_goals WHERE id = ?', [goalId]);
  return { id: Number(goalId), deleted: true };
}

export async function getById(id) {
  const rows = await query(`SELECT ${COLS} FROM planner_goals WHERE id = ?`, [id]);
  if (!rows.length) throw ApiError.notFound('goal not found');
  return (await enrichGoals(rows))[0];
}

// ── Enrichment: current value, reconciled status, shaped payload ────────────────

async function enrichGoals(rows) {
  if (!rows.length) return [];

  // One live-follower Graph call per distinct page that has a followers goal.
  const followerPages = [...new Set(rows.filter((r) => r.metric === 'followers').map((r) => r.account_id))];
  const liveFollowers = new Map();
  await Promise.all(
    followerPages.map(async (accountId) => {
      liveFollowers.set(accountId, await captureFollowerCount(accountId));
    }),
  );

  const out = [];
  for (const row of rows) {
    let goal = row;
    // Backfill a missing followers baseline (Graph was down at creation) the first
    // time we can read the page — so growth is measured from now rather than staying 0.
    if (goal.metric === 'followers' && goal.baseline_value == null) {
      const live = liveFollowers.get(goal.account_id);
      if (live != null) {
        await query('UPDATE planner_goals SET baseline_value = ? WHERE id = ?', [live, goal.id]);
        goal = { ...goal, baseline_value: live };
      }
    }
    const current = await computeCurrentValue(goal, liveFollowers);
    const reconciled = await reconcileStatus(goal, current);
    out.push(shape(goal, current, reconciled));
  }
  return out;
}

// Growth within the goal's date range (see file header).
async function computeCurrentValue(goal, liveFollowers) {
  const { metric, account_id, start_date, end_date } = goal;

  if (metric === 'followers') {
    const live = liveFollowers.get(account_id);
    if (live == null || goal.baseline_value == null) return 0;
    return Math.max(0, Number(live) - Number(goal.baseline_value));
  }

  if (metric === 'posts') {
    // "Contents" = pool posts + published Stories (each one row per publish).
    const [poolRows, storyRows] = await Promise.all([
      query(
        `SELECT COUNT(*) AS n FROM post_pool
          WHERE account_id = ? AND status = 'posted'
            AND posted_at >= ? AND posted_at < DATE_ADD(?, INTERVAL 1 DAY)`,
        [account_id, start_date, end_date],
      ),
      query(
        `SELECT COUNT(*) AS n FROM page_stories
          WHERE account_id = ? AND status = 'posted'
            AND posted_at >= ? AND posted_at < DATE_ADD(?, INTERVAL 1 DAY)`,
        [account_id, start_date, end_date],
      ),
    ]);
    return Number(poolRows[0]?.n || 0) + Number(storyRows[0]?.n || 0);
  }

  if (metric === 'sales') {
    // Committed revenue = sum of order totals in the range, excluding cancelled.
    const rows = await query(
      `SELECT COALESCE(SUM(total), 0) AS n FROM orders
        WHERE account_id = ? AND status <> 'cancelled'
          AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [account_id, start_date, end_date],
    );
    return Math.round(Number(rows[0]?.n || 0));
  }

  if (NPS_BUCKET[metric]) {
    // NPS survey responses of this score bucket, answered within the range.
    const rows = await query(
      `SELECT COUNT(*) AS n FROM conversation_surveys
        WHERE account_id = ? AND is_test = 0 AND nps IS NOT NULL AND ${NPS_BUCKET[metric]}
          AND responded_at >= ? AND responded_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [account_id, start_date, end_date],
    );
    return Number(rows[0]?.n || 0);
  }

  const col = ENGAGEMENT_COLUMN[metric]; // whitelisted above
  const rows = await query(
    `SELECT COALESCE(SUM(${col}), 0) AS n FROM post_pool
      WHERE account_id = ? AND status = 'posted'
        AND posted_at >= ? AND posted_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [account_id, start_date, end_date],
  );
  return Number(rows[0]?.n || 0);
}

// Persist terminal transitions so they freeze. Target hit → completed (stays
// completed). Past the end of the range → expired. Otherwise ongoing.
async function reconcileStatus(goal, current) {
  if (goal.status === 'completed') return { status: 'completed', completed_at: goal.completed_at };

  if (Number(current) >= Number(goal.target_value)) {
    await query('UPDATE planner_goals SET status = ?, completed_at = NOW() WHERE id = ?', ['completed', goal.id]);
    return { status: 'completed', completed_at: new Date() };
  }

  if (isPastRange(goal.end_date)) {
    if (goal.status !== 'expired') await query('UPDATE planner_goals SET status = ? WHERE id = ?', ['expired', goal.id]);
    return { status: 'expired', completed_at: null };
  }

  if (goal.status !== 'ongoing') await query('UPDATE planner_goals SET status = ? WHERE id = ?', ['ongoing', goal.id]);
  return { status: 'ongoing', completed_at: null };
}

// The goal stays ongoing THROUGH its end date; it's past the range once the day
// after end_date has begun.
function isPastRange(endDate) {
  const cutoff = new Date(`${endDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  return new Date() >= cutoff;
}

function shape(goal, current, reconciled) {
  const target = Number(goal.target_value);
  const cur = Number(current);
  const progress = target > 0 ? Math.min(cur / target, 1) : reconciled.status === 'completed' ? 1 : 0;
  return {
    id: goal.id,
    account_id: goal.account_id,
    plan_id: goal.plan_id,
    created_by: goal.created_by,
    title: goal.title,
    metric: goal.metric,
    period: goal.period,
    target_value: target,
    current_value: cur,
    baseline_value: goal.baseline_value == null ? null : Number(goal.baseline_value),
    progress, // 0..1, clamped
    percent: Math.round(progress * 100),
    start_date: goal.start_date,
    end_date: goal.end_date,
    status: reconciled.status,
    completed_at: reconciled.completed_at || null,
    created_at: goal.created_at,
    updated_at: goal.updated_at,
  };
}

function summarize(goals) {
  const counts = { ongoing: 0, completed: 0, expired: 0 };
  let sum = 0;
  for (const g of goals) {
    counts[g.status] = (counts[g.status] || 0) + 1;
    sum += g.progress;
  }
  const overall = goals.length ? sum / goals.length : 0;
  return { total: goals.length, counts, overall_progress: overall, overall_percent: Math.round(overall * 100) };
}

// ── Plan shaping / helpers ──────────────────────────────────────────────────

function shapePlan(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    created_by: p.created_by,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function toMember(r) {
  return { id: Number(r.uid), name: r.name || r.email || 'User', email: r.email || '', role: r.role };
}

async function hydrateOnePlan(planRow, role) {
  const [memberRows, goalRows] = await Promise.all([
    query(
      `SELECT m.role, u.id AS uid, u.name, u.email
         FROM planner_plan_members m JOIN users u ON u.id = m.user_id
        WHERE m.plan_id = ? ORDER BY (m.role = 'owner') DESC, u.name ASC, u.email ASC`,
      [planRow.id],
    ),
    query(`SELECT ${COLS} FROM planner_goals WHERE plan_id = ? ORDER BY created_at DESC`, [planRow.id]),
  ]);
  const goals = await enrichGoals(goalRows);
  return {
    ...shapePlan(planRow),
    role,
    members: memberRows.map(toMember),
    goals,
    summary: summarize(goals),
  };
}

async function requireOwner(user, planId, action) {
  const role = await getPlanRole(user, planId);
  if (!role) throw ApiError.notFound('plan not found');
  if (role !== 'owner') throw ApiError.forbidden(`Only an owner can ${action}.`);
  return role;
}

async function ownerCount(planId) {
  const rows = await query("SELECT COUNT(*) AS n FROM planner_plan_members WHERE plan_id = ? AND role = 'owner'", [planId]);
  return Number(rows[0]?.n || 0);
}

async function getRawRow(id) {
  const rows = await query(`SELECT ${COLS} FROM planner_goals WHERE id = ?`, [id]);
  if (!rows.length) throw ApiError.notFound('goal not found');
  return rows[0];
}

// Current live follower count for a page (fans fallback). Best-effort: null on any failure.
async function captureFollowerCount(accountId) {
  try {
    const dec = await getDecrypted(accountId);
    const profile = await fetchPageProfile({ token: dec.access_token, fbPageId: dec.fb_page_id });
    const val = profile?.followers ?? profile?.fans ?? null;
    return val == null ? null : Number(val);
  } catch {
    return null;
  }
}

// ── Validation (throws 4xx ApiError so messages reach the client) ───────────────

function cleanPlanName(v) {
  const t = String(v ?? '').trim();
  if (!t) throw ApiError.badRequest('A plan name is required.');
  if (t.length > 255) throw ApiError.badRequest('Plan name is too long (max 255 characters).');
  return t;
}

function cleanPlanDescription(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t) return null;
  if (t.length > 500) throw ApiError.badRequest('Description is too long (max 500 characters).');
  return t;
}

function cleanRole(v) {
  const r = String(v ?? '').trim().toLowerCase();
  if (!PLAN_ROLES.includes(r)) throw ApiError.badRequest(`Role must be one of: ${PLAN_ROLES.join(', ')}.`);
  return r;
}

async function validateMembers(user, raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw ApiError.badRequest('Members must be a list.');
  const out = [];
  const seen = new Set();
  for (const m of raw) {
    const uid = Number(m?.user_id);
    if (!Number.isInteger(uid) || uid <= 0) throw ApiError.badRequest('Invalid member selected.');
    if (uid === Number(user.id) || seen.has(uid)) continue; // creator is owner; dedupe
    const role = cleanRole(m?.role);
    if (!(await areConnected(user.id, uid))) throw ApiError.badRequest('You can only share with people in your connections.');
    seen.add(uid);
    out.push({ user_id: uid, role });
  }
  return out;
}

async function validateCreate(body) {
  const account_id = await ensurePageExists(body.account_id);
  const start_date = cleanDate(body.start_date, 'Start date');
  const end_date = cleanDate(body.end_date, 'End date');
  if (start_date > end_date) throw ApiError.badRequest('Start date must be on or before the end date.');
  return {
    account_id,
    title: cleanTitle(body.title),
    metric: cleanMetric(body.metric),
    period: cleanPeriod(body.period),
    target_value: cleanTarget(body.target_value),
    start_date,
    end_date,
  };
}

async function validateUpdate(body, existing) {
  const patch = {};
  if ('title' in body) patch.title = cleanTitle(body.title);
  if ('metric' in body) patch.metric = cleanMetric(body.metric);
  if ('period' in body) patch.period = cleanPeriod(body.period);
  if ('target_value' in body) patch.target_value = cleanTarget(body.target_value);
  if ('account_id' in body) patch.account_id = await ensurePageExists(body.account_id);
  if ('start_date' in body) patch.start_date = cleanDate(body.start_date, 'Start date');
  if ('end_date' in body) patch.end_date = cleanDate(body.end_date, 'End date');
  const start = patch.start_date ?? existing.start_date;
  const end = patch.end_date ?? existing.end_date;
  if (String(start) > String(end)) throw ApiError.badRequest('Start date must be on or before the end date.');
  return patch;
}

function cleanTitle(v) {
  const t = String(v ?? '').trim();
  if (!t) throw ApiError.badRequest('A goal title is required.');
  if (t.length > 255) throw ApiError.badRequest('Title is too long (max 255 characters).');
  return t;
}

function cleanMetric(v) {
  const m = String(v ?? '').trim().toLowerCase();
  if (!METRICS.includes(m)) throw ApiError.badRequest(`Metric must be one of: ${METRICS.join(', ')}.`);
  return m;
}

function cleanPeriod(v) {
  const p = String(v ?? '').trim().toLowerCase();
  if (!PERIODS.includes(p)) throw ApiError.badRequest(`Period must be one of: ${PERIODS.join(', ')}.`);
  return p;
}

function cleanTarget(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw ApiError.badRequest('Target must be a whole number greater than zero.');
  }
  return n;
}

function cleanDate(v, label) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw ApiError.badRequest(`${label} must be a valid date (YYYY-MM-DD).`);
  }
  return s;
}

async function ensurePageExists(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Select a page for this goal.');
  const rows = await query('SELECT id FROM platform_accounts WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.badRequest('The selected page no longer exists.');
  return id;
}
