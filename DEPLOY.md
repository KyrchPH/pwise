# Deploy guide — content tools, insights & analytics

This branch adds:

- **Engagement refresh** on post-pool view (batched Graph reads), replacing the old n8n engagement sweep.
- **Content-calendar notes** — per-day notes with status tags, activity logging, and drag-to-move between days.
- **Per-post insights** dialog (reactions/comments/shares/views over hour/day/month).
- **Hourly insight snapshot job** (n8n → server endpoint) building per-post + page history.
- **Analytics dashboard** — page reach, engagement, follower growth, top posts (Business-Suite-style, backfilled from Meta).
- **Creatomate template library** in Settings.

## 1. Database migrations — run in order

Against the `pwise` database (MariaDB 10.6), e.g. paste into MySQL Workbench. All additive/safe.

1. `scripts/database/migrations/006_content_notes.sql`
2. `scripts/database/migrations/007_note_activity.sql`
3. `scripts/database/migrations/008_post_insight_history.sql`
4. `scripts/database/migrations/009_insight_hourly.sql`
5. `scripts/database/migrations/010_page_insights.sql`
6. `scripts/database/migrations/011_creatomate_templates.sql`

Skip any already applied. (`009` changes `post_insight_history.captured_on` → `captured_at`; the file is ordered so the foreign-key index is never dropped without a replacement.)

## 2. Deploy code (EC2 + nginx + pm2)

1. Pull this branch onto the server.
2. `npm install` (no new deps, but safe).
3. Build the client: `npm run build -w client` (nginx serves `client/dist`).
4. Restart the API: `pm2 restart <app-name>`.

## 3. n8n

**Add the insights snapshot job:**

- Import `scripts/n8n/insights-snapshot.workflow.json`.
- In the **Snapshot insights** node, set `x-service-token` to your SERVICE_TOKEN — ideally as a **Header Auth credential**, not an inline value.
- Activate it. Hourly is recommended; adjust the Schedule node if you want finer/coarser.

**Disable the OLD engagement-sync workflow** — its endpoints (`/api/scheduler/engagement/pending`, `/api/scheduler/posts/:id/engagement`) were removed, so leaving it active only logs harmless 404s.

Leave the **posting** workflow untouched.

## 4. Security — rotate the exposed tokens

The `SERVICE_TOKEN` and Facebook Page token were exposed earlier in chat. Rotate both:

- New `SERVICE_TOKEN` → server env + n8n.
- Regenerate the Facebook Page token → server `FACEBOOK_PAGE_ACCESS_TOKEN` + the posting workflow.
- Store tokens as n8n **Credentials**, not Set nodes (so exports don't leak them).

## 5. Verify

- Post pool loads (15/page, engagement refreshes on view).
- Dashboard calendar → click a day → add / tag / drag a note → check the **Activity Log**.
- Open a **published** post → **Insights** → metric + granularity dropdowns + chart.
- **Analytics** page → reach / engagement / new-follows charts (backfills ~90 days on first load) + top posts.
- **Settings → Creatomate templates** → add (paste or upload `.json`) / edit / delete.

## Notes

- Per-post insights are **forward-only** (Meta has no per-post daily history); page-level analytics backfill ~90 days from Meta's served history.
- Creatomate templates are **stored only** — wiring them into the video-generation flow is a separate step.
- `scripts/src/probe-insights.js` is a one-off read-only tool to check which Insights metrics your page/token can access.
