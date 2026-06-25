import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Register this app's APP-LEVEL webhook subscriptions (callback URL + verify token +
// fields) for Messenger, Instagram, and WhatsApp via the Graph App Subscriptions API —
// the programmatic equivalent of the dashboard's "Webhooks → (subscribe a field) → Verify
// and save". The PER-PAGE subscription (/{page-id}/subscribed_apps) is done automatically
// when you connect a page in Settings (platform_accounts.service.js); THIS is the one-time
// app-level part.
//
//   Run from server/:  npm run fb:subscribe-app            (all three)
//                       npm run fb:subscribe-app messenger  (a subset by path)
//
// Requires FACEBOOK_APP_ID, FB_APP_SECRET (or FACEBOOK_APP_SECRET), FB_WEBHOOK_VERIFY_TOKEN,
// and PUBLIC_URL. Meta runs the GET hub.challenge against each callback DURING this call,
// so the server must be reachable at PUBLIC_URL when you run it.

// Load env exactly like server.js (server/.env wins; repo-root .env is a fallback), THEN
// import env.js so process.env is populated first.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') }); // server/.env — authoritative
dotenv.config({ path: resolve(__dirname, '../../.env') }); // repo-root — fallback
const { env } = await import('./config/env.js');

// Each Meta product → its webhook object, our callback path, and the fields to subscribe.
// messaging_postbacks covers button taps (handled in inbound_gateway.service.js).
const PRODUCTS = [
  { path: 'messenger', object: 'page', fields: 'messages,messaging_postbacks' },
  { path: 'instagram', object: 'instagram', fields: 'messages,messaging_postbacks' },
  { path: 'whatsapp', object: 'whatsapp_business_account', fields: 'messages' },
];

async function subscribe(product, cfg) {
  const callbackUrl = `${cfg.publicUrl}/api/webhooks/${product.path}`;
  const body = new URLSearchParams({
    object: product.object,
    callback_url: callbackUrl,
    verify_token: cfg.verifyToken,
    fields: product.fields,
    access_token: `${cfg.appId}|${cfg.appSecret}`,
  });
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.appId}/subscriptions`;
  try {
    const res = await fetch(url, { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return { ...product, callbackUrl, ok: false, error: data.error?.message || `HTTP ${res.status}` };
    return { ...product, callbackUrl, ok: true };
  } catch (e) {
    return { ...product, callbackUrl, ok: false, error: e.message };
  }
}

async function main() {
  const cfg = {
    appId: env.facebook.appId,
    appSecret: env.facebook.appSecret,
    verifyToken: env.facebook.verifyToken,
    graphVersion: env.facebook.graphVersion,
    publicUrl: env.publicUrl,
  };
  const missing = [];
  if (!cfg.appId) missing.push('FACEBOOK_APP_ID');
  if (!cfg.appSecret) missing.push('FB_APP_SECRET');
  if (!cfg.verifyToken) missing.push('FB_WEBHOOK_VERIFY_TOKEN');
  if (!cfg.publicUrl) missing.push('PUBLIC_URL');
  if (missing.length) {
    console.error(`[fb:subscribe-app] missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Optional CLI filter by path, e.g. `npm run fb:subscribe-app messenger whatsapp`.
  const wanted = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = wanted.length ? PRODUCTS.filter((p) => wanted.includes(p.path)) : PRODUCTS;
  if (!targets.length) {
    console.error(`[fb:subscribe-app] no matching products. Choose from: ${PRODUCTS.map((p) => p.path).join(', ')}`);
    process.exit(1);
  }

  console.log(`[fb:subscribe-app] app ${cfg.appId} → ${cfg.publicUrl}/api/webhooks/* (Graph ${cfg.graphVersion})`);
  let failures = 0;
  for (const product of targets) {
    // eslint-disable-next-line no-await-in-loop
    const r = await subscribe(product, cfg);
    if (r.ok) console.log(`  ✓ ${r.path.padEnd(10)} object=${r.object} fields=${r.fields}`);
    else {
      failures += 1;
      console.error(`  ✗ ${r.path.padEnd(10)} ${r.error}`);
    }
  }
  if (failures) {
    console.error(
      `\n[fb:subscribe-app] ${failures} failed. Common causes: PUBLIC_URL not reachable (Meta runs the GET ` +
        'handshake during this call), verify-token mismatch, a field not valid for that product, or the product ' +
        'not added to the app in the dashboard.',
    );
    process.exit(1);
  }
  console.log('\n[fb:subscribe-app] done. Per-page subscriptions happen automatically when you connect a page in Settings.');
}

main();
