# Wise Assistant — n8n workflow

Grounds the dev-only "Wise Assistant" (`Rovi`) overlay in the app's real layout/navigation
context (stored in Supabase) and answers what/how/when/where/who questions about the UI.
It can also **act** for the user — navigate, reload, read local storage, fill/toggle a
control — and **read the user's own data** through the pwise REST API (never the DB).

## Request flow

```
DevScreenAgent.jsx (dev overlay)
  → POST /api/wise-assistant/ask        (requireAuth; server validates + forwards)
    │   sends: question, pathname, history, user, client_context (redacted storage +
    │          the routes this user may reach), assistant_api (read-only scoped token)
    → POST <N8N_WISE_ASSISTANT_WEBHOOK_URL>   (x-wise-assistant-secret header if set)
      ├─ Webhook → Normalize Request
      ├─ Load Supabase Context           (Postgres: navigations, screens, controls, assistant_playbook)
      ├─ Build Assistant Prompt          (system + user prompt, action contract + client context)
      ├─ Wise Agent → DeepSeek Chat Model (LLM answer)
      │     ├─ Redis Chat Memory           (per-user conversation buffer, keyed by user id)
      │     └─ pwise API (read-only) tool  (GET back into /api/* with the scoped token)
      ├─ Format Assistant Answer          (parses {answer, actions} JSON)
      └─ Respond to App → { answer, actions, source, model }
  ← server SANITIZES actions against an allowlist, returns { answer, actions, source }
← overlay renders the answer, then executes each action (re-checking auth client-side)
```

The server never lets the browser touch n8n directly; the secret stays server-side.

## Capabilities & guardrails

The agent may return an `actions` array (max 5) the browser executes **after** the answer:

| Action | What it does | Guardrails |
|--------|--------------|------------|
| `navigate` | Route the user to a page (e.g. `/privacy`) | Only paths in the user's **ALLOWED NAVIGATION** list; the client re-checks module/admin access via `checkNavigation`, and `ModuleRoute`/`AdminRoute` are the final backstop. |
| `reload` | Reload the current page | — |
| `read_storage` | Show the user their app `localStorage` | Values are **redacted client-side** (anything matching `token/secret/password/otp/credential/device`) before they ever leave the browser. |
| `ui` (`fill`/`toggle`/`click`) | Operate a visible control on the current page | Never touches password/OTP/file inputs, never operates profile/account screens, never follows links that leave the app or open a file picker. |

**Reading user data:** the `pwise API (read-only)` tool GETs the pwise REST API on the
user's behalf. It uses a short-lived (10-min), session-bound, `scope:wise_assistant` JWT
minted by the server — `requireAuth` rejects any non-GET request made with it, so the
agent can **read** the signed-in user's data (scoped to them by the normal API) but can
**never** mutate anything — no changing name, email, photo, password, or account settings.
The user's real login token is never sent to n8n.

**Trust boundary:** the LLM output is untrusted. The server's `sanitizeActions`
(`server/src/services/wise_assistant.service.js`) validates every action against a strict
allowlist before it reaches the browser, and the client
(`client/src/utils/wiseAssistantActions.js`) enforces the auth/DOM rules again at execution
time. Both layers must agree for an action to run.

## 1. Populate Supabase context

The four tables are created and filled by the import script from the spreadsheet
`artifacts/wise-assistant-layout-context.xlsx`:

```bash
cd scripts
# Needs a Supabase Postgres connection (one of):
#   SUPABASE_CONNECTION_STRING=postgresql://...   (or DB_HOST/DB_PORT/DATABASE/DB_USER + SUPABASE_DB_PASSWORD)
node src/import-wise-assistant-context.js
```

Creates/loads `public.navigations`, `public.screens`, `public.controls`,
`public.assistant_playbook` (each has `sort_order` + `created_at`/`updated_at`, which the
workflow query relies on). Re-run any time the spreadsheet changes — it TRUNCATEs + reloads.

## 2. Import + configure the n8n workflow

1. Import `scripts/n8n/wise-assistant.workflow.json`.
2. **Supabase Postgres credential** — open the **Load Supabase Context** node and select your
   Supabase Postgres credential (the JSON ships a placeholder id `REPLACE_WITH_SUPABASE_POSTGRES_CREDENTIAL_ID`).
   Use the Supabase connection-pooler host/port and the `postgres` user.
3. **DeepSeek** — open the **DeepSeek Chat Model** node and select your DeepSeek API
   credential (the same one your messaging workflow uses; the JSON ships a placeholder id
   `REPLACE_WITH_DEEPSEEK_CREDENTIAL_ID`). It defaults to the `deepseek-chat` model — no
   env vars or API keys to add. The **Wise Agent** node feeds the prompt through it.
4. **Webhook secret** (recommended) — the **Wise Assistant Webhook** node ships with
   **Header Auth** enabled. Create a **Header Auth** credential with Name `x-wise-assistant-secret`
   and Value = your secret, then select it on the node. See "Securing the webhook" below.
5. **pwise API (read-only) tool** — no config needed. The **Normalize Request** node passes a
   per-request `assistant_api` (base URL + scoped token) that the tool node reads via
   expressions; there is no credential to select. Just make sure n8n can reach the pwise API
   at the base URL the server sends (see `N8N_WISE_ASSISTANT_API_BASE_URL` below).
6. **Redis Chat Memory** — open the **Redis Chat Memory** node and select your Redis
   credential (the JSON ships a placeholder id `REPLACE_WITH_REDIS_CREDENTIAL_ID`; reuse the
   same Redis your other workflows use). The session key is `wise-assistant:<user id>`, so the
   buffer is **per user** — one person's Rovi thread never leaks into another's. The app also
   sends the last 8 messages in each request, so this buffer is complementary continuity, not
   the only source of history; if you don't run Redis, delete this node and the agent still
   works on the app-supplied history alone.
7. **Activate** the workflow and copy its **Production** webhook URL
   (e.g. `https://<your-n8n>/webhook/wise-assistant`).

## 3. Point the app at it

In the server `.env` (see `server/.env.example`):

```
N8N_WISE_ASSISTANT_WEBHOOK_URL=https://<your-n8n>/webhook/wise-assistant
N8N_WISE_ASSISTANT_SECRET=<optional shared secret>   # sent as x-wise-assistant-secret
# Base URL n8n calls BACK for the user's data. Defaults to PUBLIC_URL, then
# http://localhost:PORT. Set it if n8n reaches the API another way (e.g. a Docker n8n
# uses http://host.docker.internal:5000).
N8N_WISE_ASSISTANT_API_BASE_URL=https://pwise-api.example.com
```

If `N8N_WISE_ASSISTANT_WEBHOOK_URL` is unset, `/api/wise-assistant/ask` returns 503 and the
overlay shows a graceful "unavailable" message. The overlay is dev-only (`import.meta.env.DEV`).
If `N8N_WISE_ASSISTANT_API_BASE_URL` is wrong/unreachable, answers still work — only the
"read my data" tool fails, and the agent falls back to answering from app context.

## Securing the webhook (`N8N_WISE_ASSISTANT_SECRET`)

The webhook URL is otherwise callable by anyone who learns it (it spends DeepSeek tokens and
reads your DB). The secret is a shared string that must match on **both** sides:

1. **Generate one** — any long random string, e.g.
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. **App** — put it in the server `.env` as `N8N_WISE_ASSISTANT_SECRET` and restart. The server
   then sends it on every call as the header `x-wise-assistant-secret` ([wise_assistant.service.js](../../server/src/services/wise_assistant.service.js)).
3. **n8n** — Credentials → New → **Header Auth**: Name `x-wise-assistant-secret`, Value = the
   same secret. On the **Wise Assistant Webhook** node, Authentication is already set to
   **Header Auth** — just select this credential. Save + reactivate.

It is symmetric: if n8n requires the header but the app doesn't send it (secret unset), every
call returns **403**. To turn the secret off, set the webhook node's Authentication back to
**None** and clear the env var.

## Required credentials, in one place

| Where   | Credential / secret                | Used by                                  |
|---------|------------------------------------|------------------------------------------|
| n8n     | Supabase Postgres credential       | Load Supabase Context node               |
| n8n     | DeepSeek API credential            | DeepSeek Chat Model node (Wise Agent)    |
| n8n     | Redis credential                   | Redis Chat Memory node (per-user buffer) |
| n8n     | Header Auth (`x-wise-assistant-secret` = secret) | Wise Assistant Webhook node (gates access) |
| app     | `N8N_WISE_ASSISTANT_WEBHOOK_URL`   | server → n8n forward                      |
| app     | `N8N_WISE_ASSISTANT_SECRET`        | matches the n8n Header Auth value         |
| app     | `N8N_WISE_ASSISTANT_API_BASE_URL`  | base URL n8n calls back for user data (defaults to `PUBLIC_URL`) |
| scripts | Supabase connection string         | import-wise-assistant-context.js         |
