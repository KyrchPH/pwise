import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import { query } from '../config/db.js';
import * as presence from '../services/messaging.presence.js';

// Throttle `last_seen_at` writes — heartbeats arrive ~every 20s, but we don't need a
// DB write that often. At most one write per user per this window (offline forces one).
const LAST_SEEN_WRITE_MS = 30000;
const lastWrite = new Map();

async function touchLastSeen(userId, force = false) {
  const id = Number(userId);
  if (!Number.isInteger(id)) return;
  const now = Date.now();
  if (!force && now - (lastWrite.get(id) || 0) < LAST_SEEN_WRITE_MS) return;
  lastWrite.set(id, now);
  // UTC_TIMESTAMP() (not NOW()) so the stored value matches the pool's timezone:'Z'
  // UTC read-back — otherwise a non-UTC DB session stores a future-looking time and the
  // client's "time since" clamps to 0.
  await query('UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [id]).catch(() => {});
}

// The client heartbeat (usePresenceHeartbeat) calls this every ~20s while the user is
// logged in and their tab is active — keeps them "online" and stamps last_seen_at.
export const ping = asyncHandler(async (req, res) => {
  await presence.touch(req.user.id);
  await touchLastSeen(req.user.id);
  sendSuccess(res, { online: true });
});

// Sent when the tab goes hidden or the user logs out (TTL covers hard closes).
export const offline = asyncHandler(async (req, res) => {
  await presence.goOffline(req.user.id);
  await touchLastSeen(req.user.id, true); // they were active up to this moment
  sendSuccess(res, { online: false });
});

// Presence for every active user — { userId, online, lastSeenAt } — so the client can
// badge teammate avatars (green/grey dot) and show "Active now" / "Active X ago".
export const status = asyncHandler(async (req, res) => {
  const users = await query('SELECT id, last_seen_at FROM users WHERE is_active = 1 AND deleted_at IS NULL');
  const onlineIds = new Set(await presence.filterOnline(users.map((u) => u.id)));
  sendSuccess(res, {
    presence: users.map((u) => ({
      userId: u.id,
      online: onlineIds.has(Number(u.id)),
      lastSeenAt: u.last_seen_at,
    })),
  });
});
