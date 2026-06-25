-- =====================================================================
-- Migration 040 — Instagram + WhatsApp channels on a page
-- IG + WhatsApp attach as OPTIONAL channels on an existing platform_accounts (page)
-- row, exactly like the optional telegram_bot_* columns. Instagram reuses the page's
-- access_token to send (it's the Messenger Platform); WhatsApp Cloud API has its own
-- (encrypted) token + phone number id. Inbound resolves the account by
-- instagram_account_id / wa_phone_number_id. Run ONCE. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN instagram_account_id   VARCHAR(64)  NULL,  -- IG professional account id (reuses access_token)
  ADD COLUMN instagram_username     VARCHAR(255) NULL,
  ADD COLUMN wa_phone_number_id     VARCHAR(64)  NULL,  -- WhatsApp Cloud API phone number id
  ADD COLUMN wa_business_account_id VARCHAR(64)  NULL,  -- WABA id (for subscribe + admin)
  ADD COLUMN wa_phone_display       VARCHAR(40)  NULL,  -- human number for display
  ADD COLUMN wa_access_token        TEXT         NULL;  -- ENCRYPTED WhatsApp system-user token

ALTER TABLE platform_accounts
  ADD INDEX idx_pa_instagram (instagram_account_id),
  ADD INDEX idx_pa_whatsapp  (wa_phone_number_id);
