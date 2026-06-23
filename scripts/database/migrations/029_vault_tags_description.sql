-- =====================================================================
-- Migration 029 - Vault per-file description + tags (AI media metadata)
-- Enriches the AI agent's media search: alongside the filename, the agent can
-- now match a customer's words against human-curated `tags` and a free-text
-- `description`. Ranking is weighted — tags (curated) beat the filename, which
-- beats the free-text description (see searchAiMedia in vault.service.js).
--   description — free text, shown/edited in the Vault "Details" panel.
--   tags        — normalized, comma-separated, lowercased keywords ("mop,promo").
-- Both apply to files; folders may carry them too, but the AI only reads files.
-- Run once. Additive — safe.
-- =====================================================================

ALTER TABLE vault_items
  ADD COLUMN IF NOT EXISTS description TEXT NULL,
  ADD COLUMN IF NOT EXISTS tags VARCHAR(512) NOT NULL DEFAULT '';
