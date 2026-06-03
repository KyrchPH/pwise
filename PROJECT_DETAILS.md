# pwise — Project Details

## Project Overview

**pwise** is an automated social-media post scheduler built for **Wise Cleaner Shop**. It lets an invite-only team upload media and captions into a central **content pool**, schedule each post for an exact date and time, and have it published automatically to the brand's **Facebook Page** — then tracks the engagement (reactions, comments, shares, views) each post earns, all from one branded dashboard.

The system is split into a **management app** and an **automation engine**:

- The **pwise app** (web client + API server) is the system of record — it handles accounts, the content pool, scheduling, media storage, and analytics display. The API server is the **only** component that touches the database.
- **n8n** is the autoposting engine. On a schedule it claims due posts from the API, publishes them to Facebook via the **Graph API**, and syncs each post's engagement back into pwise. This keeps publishing credentials and orchestration in n8n while centralizing all data and validation in the API.

### Architecture at a glance

| Component | Stack | Role |
| --- | --- | --- |
| **Client** (`pwise.sixpent.com`) | Vite + React (SPA) | Management UI — dashboard, pool, upload, scheduling, settings, accounts |
| **API server** (`pwise-api.sixpent.com`) | Node + Express + MySQL + S3 | Auth, data/CRUD, media uploads, machine endpoints for n8n |
| **Automation** | n8n + Facebook Graph API | Publishes scheduled posts; syncs engagement |
| **Database** | MySQL 8.0 (EC2) | Users, posts, settings, logs |
| **Media storage** | AWS S3 | Private media objects (served via presigned URLs) |
| **Destination** | Facebook Page | Where content is published |

### How a post flows through the system

1. A user uploads media + a caption and schedules it for an exact date/time → stored in the **post pool** (status `ready`).
2. At the scheduled time, **n8n** atomically claims the post, publishes it to the Facebook Page, and marks it `posted` (or `failed`) with a log entry + an email notification.
3. n8n periodically **syncs engagement** (reactions, comments, shares, views) back onto the post.
4. The user can later **edit the caption** or **delete** the post from pwise — and the change is propagated to the live Facebook post.

---

## Full Description — Features

### 1. Accounts & Access Control (invite-only)
- **No open signup** — registration is invite-only.
- **Admins generate single-use invite links** (unique token, optional expiry); new users join via a `/signup?token=…` link that validates and consumes the invite.
- **Roles:** `admin` and `user`.
- **Admin "Accounts" panel:** create/list invites, list users, activate/deactivate accounts, and soft-delete users. (Admins can't act on their own account.)
- **JWT authentication** with the user re-validated against the database on every request — so deactivating or deleting an account takes effect instantly.
- **First admin** is bootstrapped via a one-off CLI command (since signup is invite-only).
- Login-only sign-in page with password show/hide.

### 2. Content Pool (uploading & managing posts)
- **Upload images or videos** with a caption.
- **Direct-to-S3 uploads** via presigned URLs (the browser uploads straight to S3) with a **live progress bar**; a drag-and-drop media dropzone and thumbnail previews.
- **Post lifecycle statuses:** `draft`, `ready`, `posting`, `posted`, `failed`, `archived`.
- **Per-user ownership & isolation** — each user only sees and manages their own posts.
- **Post pool view:** content cards showing thumbnail, caption, status badge, schedule, and engagement; **filter tabs** (All / Ready / Posting / Posted / Failed / Archived).
- **Post detail viewer** with the full caption and engagement breakdown.
- **Edit caption** and **delete** posts (propagated to Facebook for already-published posts — see §6).

### 3. Scheduling
- **Exact date/time scheduling** — every post is scheduled to a specific date and time (on `:00`/`:30` slots).
- **Smart defaults:** the schedule fields pre-fill to **today** + the **next available time** slot.
- **One post per slot** — built-in conflict detection prevents double-booking a date/time (checked both before upload and on save).
- **Timezone** setting per account.
- **Content calendar** on the dashboard — a month view highlighting which days have scheduled posts.

### 4. Automated Publishing (n8n engine)
- n8n **atomically claims** the next due scheduled post (`SELECT … FOR UPDATE SKIP LOCKED`), guaranteeing no double-posting across concurrent runs.
- **Publishes to the Facebook Page** via the Graph API, supporting **videos/reels, photos, and text** posts.
- Marks each post **posted** (recording the platform post ID) or **failed**, and writes a **posting log** entry.
- **Master on/off toggle** per account pauses all publishing without deleting anything (scheduled posts simply wait).
- Posts go out at their **scheduled time** — there is no fixed-interval posting.

### 5. Engagement Analytics
- n8n's **engagement-sync flow** pulls **reactions, comments, shares, and video/reel views** from the Graph API and writes them back onto each post.
- Displayed on cards and in the post viewer with clean **outline icons** (heart, comment, share, eye) plus a "last updated" timestamp.
- Per-post counts are stored for reporting (`reactions_count`, `comments_count`, `shares_count`, `views_count`).

### 6. Facebook Post Management (two-way sync)
- **Delete-through:** deleting a published post in pwise also **deletes it on the Facebook Page** (so the user never has to go to Facebook to remove it).
- **Caption edit-through:** editing a published post's caption **updates it on Facebook** (using the correct field per media type — video, photo, or text).
- **Safety:** if the Facebook action fails, the local change is aborted and the error surfaced, so the app and the live page never silently drift; an already-deleted post is handled gracefully.

### 7. Settings
- **Auto-posting** master toggle.
- **Timezone** selection.
- **Low-pool alert threshold** + **owner email** for notifications.

### 8. Dashboard & History
- **At-a-glance stats:** total / ready / posted / failed / draft counts.
- **Low-pool alert banner** when scheduled content is running low.
- **Automation status** and **scheduled-post count**, plus the content calendar.
- **Logs / posting history** — a record of every publish attempt (outcome, message, timestamps).

### 9. Notifications
- **Branded HTML emails** on publish **success** and **failure** (styled to match Wise Cleaner Shop).
- **Low-pool alert email** to the owner, with a 24-hour cooldown to avoid spam.

### 10. Security
- **JWT** auth + **bcrypt** password hashing.
- **Service-token** machine authentication (timing-safe) for all n8n-facing endpoints.
- **Invite-only** registration.
- **Centralized data access** — only the API server touches MySQL; S3 objects are **private** and only reachable via short-lived presigned URLs.
- **Per-user data isolation** across the pool, settings, and logs.

### 11. Branding & UX
- Themed to match the **Wise Cleaner Shop** storefront (bright, playful blue/yellow/red, light theme).
- Sidebar dashboard layout, responsive design, toast notifications, upload progress, and a public **Privacy Policy** page.

---

## Technical Summary

**Monorepo (npm workspaces):** `client/` (UI), `server/` (API), `scripts/` (DB migrations + ops).

**Frontend:** React, Vite, React Router.
**Backend:** Node.js, Express, `mysql2`, `jsonwebtoken` (JWT), `bcryptjs`, AWS SDK v3 (S3 + presigned URLs), `nodemailer`.
**Database:** MySQL 8.0 — tables: `users`, `invites`, `post_pool`, `posting_settings`, `posting_logs`, `platform_accounts`.
**Automation:** n8n workflows calling the Facebook Graph API.
**Media storage:** AWS S3.
**Hosting:** EC2 + nginx (reverse proxy) + pm2, HTTPS via Let's Encrypt; client served as a static SPA.
