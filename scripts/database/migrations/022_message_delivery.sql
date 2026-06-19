-- =====================================================================
-- Migration 022 — message delivery status + platform message id
-- external_id stores the customer-platform message id (e.g. Telegram message_id)
-- so a Live Agent's reply can be threaded (reply_to) on the origin platform.
-- delivery_status records whether an outgoing message reached the customer, so a
-- failed push surfaces in the inbox instead of failing silently. Run ONCE
-- (MariaDB 10.6). Additive — safe.
-- =====================================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS external_id     VARCHAR(64) NULL AFTER reply_to,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(16) NULL AFTER external_id;
