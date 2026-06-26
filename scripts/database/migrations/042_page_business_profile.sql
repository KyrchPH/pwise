-- =====================================================================
-- Migration 042 — Per-page Business profile (contact / location / hours)
-- A page's stable "business card" info — address, phone, Viber/WhatsApp, email,
-- operating hours, website, plus a free-form notes field. Admins fill it in from the
-- page settings, and the AI agent reads it through its get_page_info tool so it can
-- answer "where are you?", "what are your hours?", "how do I contact you?" without
-- inventing anything. Stored as ONE JSON object (every field optional); NULL = the
-- page has no profile yet. Run ONCE. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN business_profile JSON NULL;
