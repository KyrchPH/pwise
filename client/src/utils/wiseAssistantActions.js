// Wise Assistant client actions — the executor for the `actions` array the n8n
// workflow returns with an answer. The server already sanitized the shapes
// (wise_assistant.service.js); this module enforces the CLIENT-side rules:
//   - navigation must respect the user's module/admin access (route guards remain
//     the backstop — a bad navigate still just bounces to /dashboard),
//   - localStorage reads never expose token-ish values,
//   - UI fill/toggle/click only touches safe, visible controls inside the app
//     (never password/OTP/file inputs, never account/profile forms, never
//     external links).
import { canAccessModule, isAdminRole } from '../config/modules.js';
import { emitWiseUi } from './wiseUiBus.js';

// ── Navigation ────────────────────────────────────────────────────────────────
// Every route the assistant may take the user to, with the access rule that guards
// it. Mirrored by NAVIGABLE_PATHS in server/src/services/wise_assistant.service.js.
export const NAVIGABLE_ROUTES = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/content-calendar', label: 'Content Calendar', moduleId: 'content-calendar' },
  { path: '/planner', label: 'Planner', moduleId: 'planner' },
  { path: '/analytics', label: 'Analytics', moduleId: 'analytics' },
  { path: '/insights', label: 'Insights', moduleId: 'insights' },
  { path: '/post-pool', label: 'Contents', moduleId: 'post-pool' },
  { path: '/upload', label: 'Upload', moduleId: 'upload' },
  { path: '/shop', label: 'Shop', moduleId: 'products' },
  { path: '/shop/products', label: 'Shop — Products', moduleId: 'products' },
  { path: '/shop/discounts', label: 'Shop — Discounts', moduleId: 'products' },
  { path: '/shop/orders', label: 'Shop — Orders', moduleId: 'products' },
  { path: '/shop/receipts', label: 'Shop — Receipts', moduleId: 'products' },
  { path: '/settings', label: 'Settings', moduleId: 'settings' },
  { path: '/logs', label: 'Logs', moduleId: 'logs' },
  { path: '/activity', label: 'Activity', moduleId: 'activity' },
  { path: '/accounts', label: 'Accounts', moduleId: 'accounts', adminOnly: true },
  { path: '/messages', label: 'Messaging', moduleId: 'messages' },
  { path: '/connections', label: 'Connections', moduleId: 'connections' },
  { path: '/vault', label: 'Vault', moduleId: 'vault' },
  { path: '/profile', label: 'Profile' },
  { path: '/profile/change-password', label: 'Change Password' },
  { path: '/privacy', label: 'Privacy Policy', public: true },
];

// Can the signed-in user go to `path`? Returns { ok, route } or { ok:false, message }.
export function checkNavigation(user, path) {
  const route = NAVIGABLE_ROUTES.find((r) => r.path === path);
  if (!route) return { ok: false, message: `I can't navigate to \`${path}\` — it isn't a page I know.` };
  if (route.public) return { ok: true, route };
  if (!user) return { ok: false, message: 'You need to be signed in for that page.' };
  if (route.adminOnly && !isAdminRole(user.role)) {
    return { ok: false, message: `**${route.label}** is admin-only, and this account isn't an admin.` };
  }
  if (route.moduleId && !canAccessModule(user, route.moduleId)) {
    return { ok: false, message: `This account doesn't have access to **${route.label}**.` };
  }
  return { ok: true, route };
}

// The routes THIS user may open — sent along with each question so the model only
// offers navigation the user is actually allowed.
export function allowedRoutesForUser(user) {
  return NAVIGABLE_ROUTES.filter((route) => checkNavigation(user, route.path).ok).map(
    (route) => ({ path: route.path, label: route.label }),
  );
}

// ── App-state actions (theme / page / sidebar / pin / notes) ──────────────────
// These drive real app state instead of hunting a DOM button, so they're reliable
// regardless of what page the user is on. Theme + page are applied by DevScreenAgent
// (they need React context); sidebar/pin/notes are emitted on the UI bus because
// their state lives in sibling components (AppLayout / WiseNotes). normalizeText and
// scoreMatch are hoisted function declarations defined lower in this file.

// Sidebar collapse/expand. AppLayout owns the state and resolves 'toggle'.
export function executeSidebar(op) {
  const clean = ['collapse', 'expand', 'toggle'].includes(op) ? op : 'toggle';
  emitWiseUi({ kind: 'sidebar', op: clean });
  const label = clean === 'collapse' ? 'Collapsed' : clean === 'expand' ? 'Expanded' : 'Toggled';
  return { ok: true, message: `${label} the sidebar.` };
}

// Show/hide the Wise Notes sticky notes. WiseNotes owns the `hidden` flag.
export function executeNotes(op) {
  const clean = ['show', 'hide', 'toggle'].includes(op) ? op : 'toggle';
  emitWiseUi({ kind: 'notes', op: clean });
  const label = clean === 'show' ? 'Showing' : clean === 'hide' ? 'Hiding' : 'Toggling';
  return { ok: true, message: `${label} your Wise Notes.` };
}

// Pinning applies only to real sidebar destinations the user can actually open — so
// it reuses the navigation allow-list + access check. /shop sub-paths, the profile
// pages and the public privacy page aren't sidebar items, so they aren't pinnable.
const NON_PINNABLE = new Set([
  '/privacy',
  '/profile',
  '/profile/change-password',
  '/shop/products',
  '/shop/discounts',
  '/shop/orders',
  '/shop/receipts',
]);

export function resolvePinTarget(user, target) {
  if (!normalizeText(target)) return { ok: false, message: 'Tell me which sidebar item to pin.' };
  let best = null;
  let bestScore = 0;
  for (const route of NAVIGABLE_ROUTES) {
    if (NON_PINNABLE.has(route.path)) continue;
    const score = scoreMatch(target, [normalizeText(route.label), normalizeText(route.path.replace(/\//g, ' '))]);
    if (score > bestScore) {
      best = route;
      bestScore = score;
    }
  }
  if (!best || bestScore < 40) return { ok: false, message: `I couldn't tell which sidebar item “${target}” refers to.` };
  const access = checkNavigation(user, best.path);
  if (!access.ok) return access; // reuse the "no access / admin-only" message
  return { ok: true, route: best };
}

// Emit a pin/unpin/toggle for a sidebar route; AppLayout resolves 'toggle'.
export function executePin(user, target, op) {
  const desired = ['pin', 'unpin', 'toggle'].includes(op) ? op : 'toggle';
  const resolved = resolvePinTarget(user, target);
  if (!resolved.ok) return resolved;
  emitWiseUi({ kind: 'pin', path: resolved.route.path, op: desired });
  const verb = desired === 'pin' ? 'Pinned' : desired === 'unpin' ? 'Unpinned' : 'Toggled the pin for';
  const prep = desired === 'unpin' ? 'from' : 'to';
  return { ok: true, message: `${verb} **${resolved.route.label}** ${prep} Quick Access.` };
}

// Match a page by name against the connected pages (field: account_name). Pure —
// DevScreenAgent has switchPage from context and performs the switch.
export function resolvePageTarget(pages, target) {
  if (!Array.isArray(pages) || !pages.length) {
    return { ok: false, message: 'There are no connected pages to switch to.' };
  }
  if (!normalizeText(target)) return { ok: false, message: 'Tell me which page to switch to.' };
  let best = null;
  let bestScore = 0;
  for (const page of pages) {
    const score = scoreMatch(target, [normalizeText(page.account_name)]);
    if (score > bestScore) {
      best = page;
      bestScore = score;
    }
  }
  if (!best || bestScore < 40) {
    const names = pages.map((p) => p.account_name).filter(Boolean).join(', ');
    return { ok: false, message: `I couldn't match “${target}” to a connected page. You have: ${names}.` };
  }
  return { ok: true, page: best };
}

// ── localStorage (read-only, redacted) ────────────────────────────────────────
// Values that smell like credentials are masked BEFORE they leave the browser —
// they never reach the server, n8n, or the LLM, and never render in the chat
// (chat history is itself persisted and re-sent as context).
const SENSITIVE_KEY_PATTERN = /token|secret|password|otp|credential|device/i;
// The assistant's own conversation cache — noise, and it IS the chat already.
const SKIP_KEY_PREFIXES = ['pwise.wiseAssistant.chat.'];
const MAX_SNAPSHOT_ITEMS = 40;
const MAX_SNAPSHOT_VALUE_LEN = 200;

function redactEntry(key, raw) {
  const value = String(raw ?? '');
  if (SENSITIVE_KEY_PATTERN.test(key)) return `[redacted — ${value.length} chars]`;
  if (value.length > MAX_SNAPSHOT_VALUE_LEN) return `${value.slice(0, MAX_SNAPSHOT_VALUE_LEN)}… (${value.length} chars)`;
  return value;
}

// Compact [{ key, value }] snapshot of localStorage for the model's context.
export function storageSnapshot() {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      if (entries.length >= MAX_SNAPSHOT_ITEMS) break;
      const key = localStorage.key(i);
      if (!key || SKIP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      entries.push({ key, value: redactEntry(key, localStorage.getItem(key)) });
    }
  } catch {
    /* storage unavailable — send nothing */
  }
  return entries;
}

// Human-readable storage listing for the read_storage action (shown in the chat).
export function describeStorage(key) {
  try {
    if (key) {
      const raw = localStorage.getItem(key);
      if (raw == null) return `There's nothing stored under \`${key}\`.`;
      return `\`${key}\` = ${redactEntry(key, raw)}`;
    }
    const entries = storageSnapshot();
    if (!entries.length) return 'Local storage is empty right now.';
    return ['Here is what this app keeps in local storage (sensitive values stay masked):']
      .concat(entries.map((entry) => `- \`${entry.key}\`: ${entry.value}`))
      .join('\n');
  } catch {
    return "I couldn't read local storage in this browser.";
  }
}

// ── UI actions (fill / toggle / click) ────────────────────────────────────────
// Account/profile screens are off-limits: the assistant must never edit user or
// account details, so it doesn't operate controls there at all.
const PROTECTED_ROUTE_PREFIXES = ['/profile'];

function isProtectedRoute(pathname) {
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Inputs the assistant must never touch: credentials, one-time codes, and file
// pickers (clicking a file input opens the OS file dialog — outside the app).
function isSensitiveControl(el) {
  const type = (el.type || '').toLowerCase();
  if (type === 'password' || type === 'file' || type === 'hidden') return true;
  const hints = `${el.name || ''} ${el.id || ''} ${el.autocomplete || ''}`;
  return /password|one-time|otp|secret|cvv|card/i.test(hints);
}

function isVisible(el) {
  if (!el || el.disabled) return false;
  if (el.closest('.dev-agent-overlay')) return false; // never operate the assistant itself
  const rects = el.getClientRects();
  if (!rects.length) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.pointerEvents !== 'none';
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// All the human-facing names an element answers to.
function labelsFor(el) {
  const labels = [];
  const push = (v) => {
    const text = normalizeText(v);
    if (text) labels.push(text);
  };
  push(el.getAttribute('aria-label'));
  push(el.placeholder);
  push(el.title);
  push(el.name);
  push(el.id);
  if (el.labels) for (const label of el.labels) push(label.textContent);
  const wrapping = el.closest('label');
  if (wrapping) push(wrapping.textContent);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    labelledBy.split(/\s+/).forEach((id) => push(document.getElementById(id)?.textContent));
  }
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button') push(el.textContent);
  if (tag === 'INPUT' && (el.type === 'button' || el.type === 'submit')) push(el.value);
  return labels;
}

function scoreMatch(target, labels) {
  const wanted = normalizeText(target);
  if (!wanted) return 0;
  let best = 0;
  const tokens = wanted.split(' ').filter(Boolean);
  for (const label of labels) {
    let score = 0;
    if (label === wanted) score = 100;
    else if (label.startsWith(wanted)) score = 80;
    else if (label.includes(wanted)) score = 60;
    else if (tokens.length > 1 && tokens.every((t) => label.includes(t))) score = 40;
    if (score > best) best = score;
  }
  return best;
}

function findControl(target, selectors) {
  let best = null;
  let bestScore = 0;
  for (const el of document.querySelectorAll(selectors)) {
    if (!isVisible(el)) continue;
    const score = scoreMatch(target, labelsFor(el));
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return bestScore >= 40 ? best : null;
}

// React controlled inputs ignore a plain `el.value = x`; go through the native
// setter so React's onChange sees the new value.
function setNativeValue(el, value) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Briefly flash the element so the user sees exactly what the assistant touched.
function flash(el) {
  try {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    el.scrollIntoView();
  }
  el.classList.add('wise-action-flash');
  setTimeout(() => el.classList.remove('wise-action-flash'), 1600);
}

const FILL_SELECTORS = 'input, textarea, select, [contenteditable="true"]';
// `label` is included because styled switches are often a hidden checkbox behind a
// clickable label — the file-picker guard below keeps upload labels off-limits.
const CLICK_SELECTORS =
  'button, a, label, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], summary';

// Execute one { type:'ui', op, target, value } action on the CURRENT page.
// Returns { ok, message } — the message is appended to the chat either way.
export function executeUiAction(action) {
  const pathname = window.location.pathname;
  if (isProtectedRoute(pathname)) {
    return { ok: false, message: "I can't operate controls on profile or account pages — those changes are yours to make." };
  }

  const { op, target } = action;

  if (op === 'fill') {
    const el = findControl(target, FILL_SELECTORS);
    if (!el) return { ok: false, message: `I couldn't find a field matching “${target}” on this screen.` };
    if (isSensitiveControl(el)) {
      return { ok: false, message: `“${target}” looks like a credential or file field — I don't fill those.` };
    }
    if (el.readOnly) return { ok: false, message: `“${target}” is read-only.` };
    if (el.isContentEditable) {
      el.textContent = action.value ?? '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el instanceof HTMLSelectElement) {
      const wanted = normalizeText(action.value);
      const option = Array.from(el.options).find(
        (o) => normalizeText(o.value) === wanted || normalizeText(o.textContent) === wanted,
      );
      if (!option) return { ok: false, message: `“${target}” has no option matching “${action.value}”.` };
      setNativeValue(el, option.value);
    } else {
      setNativeValue(el, action.value ?? '');
    }
    flash(el);
    return { ok: true, message: `Filled **${target}**.` };
  }

  if (op === 'toggle' || op === 'click') {
    const el = findControl(target, CLICK_SELECTORS);
    if (!el) return { ok: false, message: `I couldn't find a control matching “${target}” on this screen.` };
    if (isSensitiveControl(el)) {
      return { ok: false, message: `“${target}” is a sensitive control — I won't touch it.` };
    }
    // A label wired to a file input would pop the OS file picker; an external or
    // new-tab link would leave the app. Both are out of bounds.
    const anchor = el.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href') || '';
      if (anchor.target === '_blank' || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        return { ok: false, message: 'That link leaves the app, so I left it for you to open.' };
      }
    }
    const labelControl = el.tagName === 'LABEL' ? el.control : null;
    if (labelControl && labelControl.type === 'file') {
      return { ok: false, message: "That opens a file picker — I can't browse files outside the app." };
    }
    if (labelControl && isSensitiveControl(labelControl)) {
      return { ok: false, message: `“${target}” is a sensitive control — I won't touch it.` };
    }
    el.click();
    flash(el);
    return { ok: true, message: `${op === 'toggle' ? 'Toggled' : 'Clicked'} **${target}**.` };
  }

  return { ok: false, message: "I don't know that kind of UI action." };
}
