# Meta messaging setup (Messenger · Instagram · WhatsApp)

How to wire the three Meta channels into pwise — from local/dev testing to a public,
reviewed production app. Telegram is separate (a per-page bot token; see Settings →
Facebook Pages → Telegram).

> **Two layers, don't confuse them**
> - **App-level subscription** — the callback URL + verify token + which webhook *fields*
>   your app listens for. Set **once per app** (this is the `fb:subscribe-app` command
>   below, or the dashboard's *Webhooks → Verify and save*).
> - **Per-page subscription** — connects a *specific* page/number to the app
>   (`/{page-id}/subscribed_apps`). **pwise does this automatically** when you connect a
>   page in Settings. You don't touch it.

---

## 1. Env (server/.env)

All three Meta products share ONE app, so they share these:

| Var | Used for |
|-----|----------|
| `PUBLIC_URL` | Public HTTPS base of this API. Meta POSTs inbound here. **Must be reachable.** |
| `FACEBOOK_APP_ID` | The Meta app id. |
| `FB_APP_SECRET` (or `FACEBOOK_APP_SECRET`) | Signs `X-Hub-Signature-256` on every Meta webhook + OAuth + app access token. |
| `WEBHOOK_VERIFY_TOKEN` (legacy: `FB_WEBHOOK_VERIFY_TOKEN`) | The GET `hub.challenge` verify token — same for Messenger, IG, WhatsApp. |
| `FB_GRAPH_VERSION` | Graph version (default `v21.0`). |

Each **WhatsApp number's** own token is stored **per page** (encrypted, in Settings →
Facebook Pages → WhatsApp), not in env. Instagram needs no extra token — it reuses the
page access token.

## 2. Subscribe the app's webhooks (programmatic)

From `server/` (with the server running and reachable at `PUBLIC_URL`):

```bash
npm run fb:subscribe-app            # Messenger + Instagram + WhatsApp
npm run fb:subscribe-app messenger  # just one (or any subset by path)
```

This calls `POST /{app-id}/subscriptions` for each product, pointing it at
`<PUBLIC_URL>/api/webhooks/{messenger,instagram,whatsapp}` with `WEBHOOK_VERIFY_TOKEN`
and fields `messages,messaging_postbacks` (WhatsApp: `messages`). Meta runs the
`hub.challenge` handshake against each callback during the call — which the server answers
automatically (`metaVerify`).

**Dashboard alternative:** App → Webhooks → pick the product → set the callback URL +
verify token → subscribe the `messages` field (and `messaging_postbacks` for button taps)
→ *Verify and save*.

To change which fields are subscribed, edit `PRODUCTS` in
`server/src/subscribe-meta-webhooks.js`.

## 3. Connect accounts in pwise (Settings → Facebook Pages)

- **Facebook / Messenger** — connect the page (token + page id), or use *Connect with
  Facebook* to import. On save, pwise auto-subscribes the page (`subscribed_apps`).
- **Instagram** — the page's IG professional account id (auto-filled by *Connect with
  Facebook* when linked, else paste it). Replies reuse the page token.
- **WhatsApp** — phone number id, WhatsApp Business Account id, and a permanent access
  token (from the Meta app's WhatsApp setup).

## 4. Test WITHOUT App Review (Development mode)

In **Development mode**, everything works for people who have a **role on the app**
(admins/developers/testers) and assets they own. So you can fully test the pipeline now:

1. App stays in Development mode.
2. Give your test users an app role (App → Roles).
3. Connect **your own** page / IG / WhatsApp test number in Settings.
4. Message the page from a test account → it lands in the inbox, the AI replies, button
   taps register as messages (the payload is forwarded to n8n).

**WhatsApp caveat:** the Cloud API **test number** can only message up to **5 pre-registered
recipient numbers** until you add + verify a real number.

## 5. Go LIVE (serve real customers)

Public customers have no app role, so their events only fire once the messaging permissions
have **Advanced Access** — that's App Review, plus its prerequisites:

**Messenger + Instagram**
- [ ] **Business Verification** (Meta Business Suite) — usually required first.
- [ ] App → **Live mode** (needs privacy-policy URL, app icon, category).
- [ ] **App Review → Advanced Access** for: `pages_messaging`, `pages_manage_metadata`,
      `pages_show_list`, `pages_read_engagement`, and for IG `instagram_basic` +
      `instagram_manage_messages` (record a screencast of the flow).
- [ ] Instagram account is **Professional** and linked to the page.

**WhatsApp** (different track — *not* the classic App Review if you use your own number)
- [ ] **Business Verification**.
- [ ] Register + verify the **phone number**; get the **display name** approved.
- [ ] Move off the test number to your real number.
- [ ] (App Review of `whatsapp_business_messaging` is only needed if you message on behalf
      of *other* businesses — a Tech Provider setup.)

## 6. Smoke-test the handshake

```bash
curl "$PUBLIC_URL/api/webhooks/messenger?hub.mode=subscribe&hub.verify_token=$WEBHOOK_VERIFY_TOKEN&hub.challenge=ping123"
# → ping123   (same for /instagram and /whatsapp)
```

## 7. Troubleshooting

- **`fb:subscribe-app` fails** → `PUBLIC_URL` not reachable (Meta handshakes during the
  call), verify-token mismatch, the product isn't added to the app, or a field isn't valid
  for that product.
- **Handshake 403** → `WEBHOOK_VERIFY_TOKEN` mismatch.
- **Inbound 401 in logs** → `X-Hub-Signature-256` mismatch → wrong `FB_APP_SECRET`.
- **Verified but no messages** → the *page/number* isn't subscribed. Re-save the page in
  Settings (re-runs `subscribed_apps`), or check it's subscribed in the dashboard.
- **Nothing reaches the inbox** → confirm `PUBLIC_URL` is the real public origin and the
  server is running there.
