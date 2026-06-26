import { env } from '../config/env.js';

// Geoapify — geocoding + driving-distance for the AI agent's delivery-distance check
// (the check_delivery_distance tool). Free-tier friendly (a few thousand req/day). The
// API key lives server-side (GEOAPIFY_API_KEY) and is NEVER exposed to n8n. Best-effort:
// every helper returns a plain object or null and never throws, so a Geoapify hiccup
// can't break an AI reply.

const BASE = 'https://api.geoapify.com/v1';

// Cache geocode results (the shop address resolves to the same point every order, and
// repeat customer addresses are common). Single API process per deployment, so a plain
// in-memory map is enough. Keyed by normalized query text.
const geoCache = new Map(); // text -> { at, value }
const GEO_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Geocode free-text address → { lat, lon, formatted, confidence } | null. Biased to the
// Philippines by default (countrycode filter) so messy local addresses resolve better.
export async function geocode(text, { countryCode = 'ph' } = {}) {
  const key = env.geoapify.apiKey;
  const q = String(text ?? '').trim();
  if (!key || !q) return null;

  const cacheKey = `${countryCode}|${q.toLowerCase()}`;
  const hit = geoCache.get(cacheKey);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) return hit.value;

  let value = null;
  try {
    const url =
      `${BASE}/geocode/search?text=${encodeURIComponent(q)}` +
      (countryCode ? `&filter=countrycode:${encodeURIComponent(countryCode)}` : '') +
      `&limit=1&apiKey=${key}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const p = data?.features?.[0]?.properties;
      if (p && typeof p.lat === 'number' && typeof p.lon === 'number') {
        value = { lat: p.lat, lon: p.lon, formatted: p.formatted || q, confidence: p.rank?.confidence ?? null };
      }
    }
  } catch {
    value = null;
  }
  // Cache successes (don't cache a transient failure — let the next order retry).
  if (value) geoCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

// Driving distance/time between two { lat, lon } points → { meters, seconds } | null.
// Geoapify routing waypoints are "lat,lon|lat,lon" (latitude first).
export async function driveDistance(from, to) {
  const key = env.geoapify.apiKey;
  if (!key || !from || !to) return null;
  try {
    const waypoints = `${from.lat},${from.lon}|${to.lat},${to.lon}`;
    const url = `${BASE}/routing?waypoints=${encodeURIComponent(waypoints)}&mode=drive&apiKey=${key}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const p = data?.features?.[0]?.properties;
    if (!p || typeof p.distance !== 'number') return null;
    return { meters: p.distance, seconds: typeof p.time === 'number' ? p.time : null };
  } catch {
    return null;
  }
}
