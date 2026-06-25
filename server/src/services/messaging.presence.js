// Agent presence — "online right now" for order routing (services/messaging.service.js
// createOrder). An agent is online while they are logged in AND have an active
// (visible) browser tab: the client sends a heartbeat every ~20s (see the client
// usePresenceHeartbeat hook) which `touch()`es a key with a short TTL. Miss a few
// heartbeats — tab hidden, closed, logged out, or the browser crashed — and the key
// expires, so they fall offline automatically with no explicit signal needed.
//
// Backed by Redis when REDIS_URL is set (so presence is shared across server
// instances); otherwise an in-memory TTL map (single process — fine for one server).
import { getRedis } from '../config/redis.js';
import { env } from '../config/env.js';

const TTL_SECONDS = 45; // a heartbeat older than this counts as offline (client beats ~20s)
const KEY = (id) => `pwise:presence:online:${id}`;
const useRedis = !!env.redis.url;

// In-memory fallback: userId -> expiry epoch ms. Entries are only ever read through
// the expiry check, so stale ones are harmless (never counted as online).
const mem = new Map();

// Heartbeat: mark this user online for the next TTL window.
export async function touch(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id)) return;
  if (!useRedis) {
    mem.set(id, Date.now() + TTL_SECONDS * 1000);
    return;
  }
  try {
    const r = await getRedis();
    if (r) await r.set(KEY(id), Date.now(), 'EX', TTL_SECONDS);
  } catch (e) {
    console.warn(`[presence] touch failed: ${e?.message || e}`);
  }
}

// Explicit offline (tab hidden / logout) — TTL also covers hard closes.
export async function goOffline(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id)) return;
  if (!useRedis) {
    mem.delete(id);
    return;
  }
  try {
    const r = await getRedis();
    if (r) await r.del(KEY(id));
  } catch (e) {
    console.warn(`[presence] offline failed: ${e?.message || e}`);
  }
}

// Of the given candidate user ids, return the subset online right now (numbers).
export async function filterOnline(userIds = []) {
  const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  if (!useRedis) {
    const now = Date.now();
    return ids.filter((id) => (mem.get(id) || 0) > now);
  }
  try {
    const r = await getRedis();
    if (!r) return [];
    const vals = await r.mget(ids.map(KEY));
    return ids.filter((_, i) => vals[i] != null);
  } catch (e) {
    // Degrade to "no one online" → orders queue in the Pool (safe) rather than mis-route.
    console.warn(`[presence] filterOnline failed: ${e?.message || e}`);
    return [];
  }
}

export async function isOnline(userId) {
  return (await filterOnline([userId])).length > 0;
}
