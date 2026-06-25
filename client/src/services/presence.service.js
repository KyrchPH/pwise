import api from './api.js';

// Heartbeat: tell the server this user is online (logged in + active tab). Called
// every ~20s by usePresenceHeartbeat while the tab is visible.
export async function ping() {
  await api.post('/presence/ping');
}

// Tell the server the user went idle (tab hidden) or is logging out. Best-effort —
// the server-side TTL also expires presence if heartbeats simply stop.
export async function offline() {
  await api.post('/presence/offline');
}

// Presence for all active users: [{ userId, online, lastSeenAt }]. Polled by
// PresenceContext to drive the avatar badges.
export async function getStatus() {
  const { data } = await api.get('/presence/status');
  return data.data.presence;
}
