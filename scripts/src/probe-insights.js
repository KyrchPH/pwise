// One-off probe: what can THIS page + token actually pull from the Insights API?
// Run from the repo root (Node 18+):  node scripts/src/probe-insights.js
// Reads FACEBOOK_PAGE_ACCESS_TOKEN / FACEBOOK_PAGE_ID / FB_GRAPH_VERSION from
// .env (root) or server/.env. Reports ✅ data / ⚠️ empty / ❌ unavailable per
// metric so we know which Business-Suite-style insights are feasible before
// building the dashboard. Nothing is written anywhere — read-only.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const env = { ...process.env };
  for (const file of [resolve(__dirname, '../../.env'), resolve(__dirname, '../../server/.env')]) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && env[m[1]] === undefined) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          env[m[1]] = v;
        }
      }
    } catch {
      /* file not present — try the next */
    }
  }
  return env;
}

const env = loadEnv();
const TOKEN = env.FACEBOOK_PAGE_ACCESS_TOKEN;
const PAGE = env.FACEBOOK_PAGE_ID;
const VER = env.FB_GRAPH_VERSION || 'v21.0';
const BASE = `https://graph.facebook.com/${VER}`;

if (!TOKEN || !PAGE) {
  console.error('Missing FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_PAGE_ID (.env or server/.env).');
  process.exit(1);
}

async function get(path, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: TOKEN });
  try {
    const res = await fetch(`${BASE}/${path}?${qs}`);
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && !json.error, json };
  } catch (e) {
    return { ok: false, json: { error: { message: e.message } } };
  }
}

const range = () => {
  const until = Math.floor(Date.now() / 1000);
  return { since: until - 30 * 86400, until };
};

async function probePage(label, metric, period = 'day') {
  const params = period === 'day' ? { metric, period, ...range() } : { metric, period };
  const { ok, json } = await get(`${PAGE}/insights`, params);
  if (!ok) return console.log(`  ❌ ${label}  [${metric}] — ${json.error?.message || 'error'}`);
  const values = json.data?.[0]?.values || [];
  const withData = values.filter((v) => (typeof v.value === 'number' ? v.value > 0 : Object.keys(v.value || {}).length)).length;
  console.log(`  ${withData ? '✅' : '⚠️ '} ${label}  [${metric}] — ${values.length} points, ${withData} non-empty`);
}

async function probePost() {
  const { ok, json } = await get(`${PAGE}/published_posts`, { fields: 'id,created_time', limit: 1 });
  if (!ok || !json.data?.length) return console.log(`  ⚠️  no recent post to test — ${json.error?.message || 'none found'}`);
  const post = json.data[0];
  console.log(`  using post ${post.id} (${post.created_time})`);
  for (const m of ['post_impressions', 'post_impressions_unique', 'post_clicks', 'post_reactions_by_type_total', 'post_video_views']) {
    const { ok: o, json: j } = await get(`${post.id}/insights`, { metric: m });
    if (!o) { console.log(`    ❌ ${m} — ${j.error?.message || 'error'}`); continue; }
    const val = j.data?.[0]?.values?.[0]?.value;
    console.log(`    ✅ ${m} — ${typeof val === 'object' ? JSON.stringify(val) : val}`);
  }
}

async function main() {
  console.log(`\nProbing Page ${PAGE} on Graph ${VER}\n`);

  console.log('Reach & impressions (over time):');
  await probePage('page impressions', 'page_impressions');
  await probePage('page reach', 'page_impressions_unique');
  await probePage('post impressions', 'page_posts_impressions');
  await probePage('post reach', 'page_posts_impressions_unique');

  console.log('\nFollower growth:');
  await probePage('total fans', 'page_fans');
  await probePage('new follows', 'page_daily_follows_unique');
  await probePage('unfollows', 'page_daily_unfollows_unique');
  await probePage('fan adds', 'page_fan_adds');
  await probePage('fan removes', 'page_fan_removes');

  console.log('\nAudience demographics (lifetime):');
  await probePage('by country', 'page_fans_country', 'lifetime');
  await probePage('by gender/age', 'page_fans_gender_age', 'lifetime');
  await probePage('by city', 'page_fans_city', 'lifetime');

  console.log('\nEngagement:');
  await probePage('post engagements', 'page_post_engagements');

  console.log('\nPer-post performance (latest post):');
  await probePost();

  console.log('\nDone. Paste this whole output back and I\'ll build around what\'s ✅.\n');
}

main().catch((e) => {
  console.error('Probe failed:', e.message);
  process.exit(1);
});
