-- =====================================================================
-- Migration 028 - Per-page AI agent system prompts
-- Each connected page can have its own admin-configured system prompt for each of
-- the three messaging agents (Sales / Support / General). NULL = fall back to the
-- built-in default (server: src/services/ai_prompt.service.js). The fixed grounding
-- / human-handoff / formatting guardrails are appended server-side at send time and
-- are NOT stored here — so a custom prompt can never disable them.
-- Run once. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN ai_prompt_sales   TEXT NULL,
  ADD COLUMN ai_prompt_support TEXT NULL,
  ADD COLUMN ai_prompt_general TEXT NULL;
