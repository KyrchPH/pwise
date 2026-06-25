import { env } from './env.js';

// Optional Redis connection — currently used for cross-instance agent presence
// (services/messaging.presence.js). When REDIS_URL is unset, presence falls back to
// an in-memory map (fine for a single server process).
//
// ioredis is imported LAZILY so the server still boots if the package isn't
// installed yet (e.g. before `npm install`) — getRedis() just resolves to null and
// presence degrades to in-memory. A connection error never crashes the app: the
// client logs and keeps retrying in the background, and callers treat a failure as
// "no data".
let clientPromise = null;

export function getRedis() {
  if (!env.redis.url) return Promise.resolve(null);
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(env.redis.url, {
        // Fail fast instead of hanging request handlers when Redis is unreachable.
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 200, 2000),
      });
      client.on('error', (e) => console.warn(`[redis] ${e?.message || e}`));
      client.on('connect', () => console.log('[redis] connected'));
      return client;
    } catch (e) {
      // ioredis not installed, or constructing the client threw — disable Redis.
      console.warn(`[redis] disabled — ${e?.message || e}`);
      return null;
    }
  })();
  return clientPromise;
}

export default getRedis;
