# Wise Assistant — n8n workflow

Grounds the dev-only "Wise Assistant" (`Rovi`) overlay in the app's real layout/navigation
context (stored in Supabase) and answers what/how/when/where/who questions about the UI.

## Request flow

```
DevScreenAgent.jsx (dev overlay)
  → POST /api/wise-assistant/ask        (requireAuth; server validates + forwards)
    → POST <N8N_WISE_ASSISTANT_WEBHOOK_URL>   (x-wise-assistant-secret header if set)
      ├─ Webhook → Normalize Request
      ├─ Load Supabase Context           (Postgres: navigations, screens, controls, assistant_playbook)
      ├─ Build Assistant Prompt          (system + user prompt, grounded in the context JSON)
      ├─ Wise Agent → DeepSeek Chat Model (LLM answer)
      ├─ Format Assistant Answer
      └─ Respond to App → { answer, source, model }
  ← server returns { answer, source }
← overlay renders the answer
```

The server never lets the browser touch n8n directly; the secret stays server-side.

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
5. **Activate** the workflow and copy its **Production** webhook URL
   (e.g. `https://<your-n8n>/webhook/wise-assistant`).

## 3. Point the app at it

In the server `.env` (see `server/.env.example`):

```
N8N_WISE_ASSISTANT_WEBHOOK_URL=https://<your-n8n>/webhook/wise-assistant
N8N_WISE_ASSISTANT_SECRET=<optional shared secret>   # sent as x-wise-assistant-secret
```

If `N8N_WISE_ASSISTANT_WEBHOOK_URL` is unset, `/api/wise-assistant/ask` returns 503 and the
overlay shows a graceful "unavailable" message. The overlay is dev-only (`import.meta.env.DEV`).

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
| n8n     | Header Auth (`x-wise-assistant-secret` = secret) | Wise Assistant Webhook node (gates access) |
| app     | `N8N_WISE_ASSISTANT_WEBHOOK_URL`   | server → n8n forward                      |
| app     | `N8N_WISE_ASSISTANT_SECRET`        | matches the n8n Header Auth value         |
| scripts | Supabase connection string         | import-wise-assistant-context.js         |
