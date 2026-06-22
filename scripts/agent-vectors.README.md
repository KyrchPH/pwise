# AI Agent vector store — MySQL → Supabase pgvector sync

Mirrors the MySQL source-of-truth tables **`products`** and **`ai_agent_reference`**
into a Supabase Postgres **pgvector** table, embedding each row with **OpenAI**
so the n8n AI agent can do semantic retrieval (RAG) over them.

- **Source of truth:** MySQL (`DATABASE_URL`). You edit data there; never edit the vectors by hand.
- **Target:** Supabase Postgres table `public.agent_documents` (one combined table, rows tagged by `source`).
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim).
- **Sync:** [src/sync-agent-vectors.js](src/sync-agent-vectors.js) — incremental, idempotent, deletes mirrored.

## How the "only embed what changed" check works

The script does the dedup/freshness check for you — there is no separate "is it
updated?" step to run:

1. Read every row from the MySQL table.
2. For each row, build the text to embed and compute `sha256(content)` + `sha256(metadata)`.
3. Compare against the hashes already stored in Supabase:
   - **Not in Supabase, or content hash changed** → (re-)embed with OpenAI and upsert.
   - **Only other columns changed** (content identical) → cheap metadata-only update, **no embedding spent**.
   - **Nothing changed** → skipped.
4. Rows that exist in Supabase but **no longer exist in MySQL** are deleted (mirror deletes).

So re-running is cheap and safe: a run with no MySQL changes makes **zero** OpenAI calls.

## 1. One-time Supabase setup

Run [database/supabase/agent_vectors.sql](database/supabase/agent_vectors.sql) once in the
**Supabase SQL editor** (enables `pgvector`, creates `agent_documents`, its indexes, and the
`match_agent_documents()` retrieval function). The sync also applies it idempotently each run,
so this is mainly for first-time setup or if the DB role can't create the extension over the pooler.

## 2. Configure env

In the repo-root `.env` (where the scripts already read `DATABASE_URL`) **or** `server/.env`:

```
DATABASE_URL=mysql://user:pass@host:3306/pwise        # MySQL source (already set for the app)
SUPABASE_CONNECTION_STRING=postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres
OPENAI_API_KEY=sk-...
# OPENAI_EMBEDDING_MODEL=text-embedding-3-small        # optional override
```

## 3. Run the sync

```bash
cd scripts
npm install                       # if you haven't (pulls pg, mysql2, dotenv)
npm run vectors:sync:dry          # preview: counts new/changed/deleted, no OpenAI calls, no writes
npm run vectors:sync              # do it for real
```

Useful flags (pass after `--`):

| Flag | Effect |
|------|--------|
| `--dry-run` | Report what would change; no embeddings, no writes. |
| `--source=products` | Sync only one source (`products` or `ai_agent_reference`). |
| `--no-delete` | Never delete from Supabase (add/update only). |
| `--allow-empty` | Allow deletes even when the MySQL table returns 0 rows (off by default, so a transient empty read can't wipe the store). |

### Tuning what gets embedded

By default every column except the primary key and `created_at`/`updated_at`/`deleted_at`
is embedded (the **full** row is always stored in `metadata` regardless). To control exactly
which columns form the embedded text, set `contentColumns` for a source in the `SOURCES`
config at the top of [src/sync-agent-vectors.js](src/sync-agent-vectors.js), e.g.
`contentColumns: ['name', 'description', 'category']`.

## 4. Keep it in sync automatically

Schedule the command on the host that can reach MySQL (e.g. cron, every 15 min):

```cron
*/15 * * * * cd /path/to/repo/scripts && /usr/bin/npm run vectors:sync >> /var/log/pwise-vectors.log 2>&1
```

(Or a self-hosted **n8n Schedule Trigger → Execute Command** node running the same command.)
Because it's hash-based, frequent runs are cheap — they no-op until MySQL actually changes.

## 5. Wire up the n8n "Supabase Vector Store" node

A ready-made messaging workflow with the vector store already wired in is at
[n8n/ai-inbound.workflow.json](n8n/ai-inbound.workflow.json) — import it, then fill in the
placeholders: your `SERVICE_TOKEN` (redacted in the `Message` node — paste it back or switch
it to `{{ $env.SERVICE_TOKEN }}`), an **OpenAI** credential on the `Embeddings OpenAI` node,
and a **Supabase API** credential on the `Knowledge Base` node. It adds a single `knowledge_base`
retrieval tool shared by the Sales, Support, and General Inquiry agents.

> **Credential gotcha:** the Supabase Vector Store node uses a **Supabase API** credential
> (your project URL + **service_role** key — it calls the `match_agent_documents` RPC over
> PostgREST), *not* the Postgres connection string the sync script uses. They are different
> credentials for the same database.

If wiring it by hand instead, on the node (used as a retriever/tool for your agent):

- **Operation:** *Retrieve Documents* (this script owns inserts — don't insert from n8n).
- **Table Name:** `agent_documents`
- **Query Name:** `match_agent_documents`
- **Embedding model (the attached "Embeddings OpenAI" node):** **must be `text-embedding-3-small`** —
  the query is embedded at search time and has to match the stored vectors, or results are garbage.
- **Metadata filter (optional):** `{"source": "products"}` to search only products, `{"source": "ai_agent_reference"}`
  for reference only, or no filter to search both.

> ⚠️ **Changing the embedding model** means re-embedding everything: update `vector(1536)` in the SQL,
> the `EMBEDDING_DIM`/model in the script, the n8n query-time model, then re-run the sync.
