// Per-page "Business profile" — the structured contact / location / hours info an
// admin fills in for a page in Settings, surfaced to the AI agent via its get_page_info
// tool. Stored as a single JSON column (platform_accounts.business_profile); every
// field is an optional string. This file is the single source of truth for the field
// list and how the profile is rendered for the agent.

export const BUSINESS_PROFILE_FIELDS = ['address', 'phone', 'viber', 'email', 'hours', 'website', 'notes'];

// Optional per-channel links (store / social URLs) the agent can share when a customer
// asks for them. Stored as a nested `links` object inside business_profile. Order = the
// order they're shown in the UI and rendered for the agent.
export const LINK_CHANNELS = ['facebook', 'telegram', 'instagram', 'shopee', 'tiktok', 'lazada'];

// Human-readable labels, used when rendering the profile for the agent.
const FIELD_LABELS = {
  address: 'Address / Location',
  phone: 'Phone',
  viber: 'Viber / WhatsApp',
  email: 'Email',
  hours: 'Operating hours',
  website: 'Website',
  notes: 'Other details',
};

const LINK_LABELS = {
  facebook: 'Facebook / Messenger',
  telegram: 'Telegram',
  instagram: 'Instagram',
  shopee: 'Shopee',
  tiktok: 'TikTok',
  lazada: 'Lazada',
};

// Pick known link channels out of a raw object, trimmed; returns {} when none usable.
function pickLinks(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const ch of LINK_CHANNELS) {
    const val = String(src[ch] ?? '').trim();
    if (val) out[ch] = val;
  }
  return out;
}

// Coerce arbitrary input (a request body) into a clean { ...fields, links } object with
// ONLY known keys and trimmed values. Returns null when nothing usable was given — that
// stores SQL NULL (the page simply has no profile yet).
export function normalizeBusinessProfile(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const key of BUSINESS_PROFILE_FIELDS) {
    const val = String(input[key] ?? '').trim();
    if (val) out[key] = val;
  }
  const links = pickLinks(input.links);
  if (Object.keys(links).length) out.links = links;
  return Object.keys(out).length ? out : null;
}

// Parse a stored value into a safe object — always returns an object ({} when empty or
// malformed) with a `links` sub-object when any are set. mysql2 returns a parsed object
// for JSON columns, but a raw string on some setups, so handle both.
export function parseBusinessProfile(stored) {
  if (!stored) return {};
  let obj = stored;
  if (typeof stored === 'string') {
    try {
      obj = JSON.parse(stored);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const key of BUSINESS_PROFILE_FIELDS) {
    const val = String(obj[key] ?? '').trim();
    if (val) out[key] = val;
  }
  const links = pickLinks(obj.links);
  if (Object.keys(links).length) out.links = links;
  return out;
}

// Render the profile as a short labelled text block for the agent's get_page_info tool —
// plain business facts it states (or links it shares) as its own knowledge. Empty string
// when nothing is set.
export function formatBusinessProfile(stored) {
  const p = parseBusinessProfile(stored);
  const lines = BUSINESS_PROFILE_FIELDS.filter((k) => p[k]).map((k) => `${FIELD_LABELS[k]}: ${p[k]}`);
  const links = p.links || {};
  const linkLines = LINK_CHANNELS.filter((ch) => links[ch]).map((ch) => `${LINK_LABELS[ch]}: ${links[ch]}`);
  if (linkLines.length) lines.push('Channel / store links —', ...linkLines);
  return lines.join('\n');
}
