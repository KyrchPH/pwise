-- =====================================================================
-- Migration 036 — Per-page discounts
-- Cart discount rules scoped to a connected page (like page_products). Each rule has
-- a value (fixed amount OR percentage, with an optional money cap when percentage)
-- and a scope deciding when it applies:
--   all              — every cart
--   category         — items in target_category
--   product          — target_product_id is in the cart
--   cart_item_count  — total cart quantity >= threshold_qty
--   product_qty      — target_product_id quantity in cart >= threshold_qty
--   min_order_amount — cart subtotal >= min_amount
-- applies_to decides whether the discount comes off the WHOLE order or only the
-- qualifying items. stackable lets a rule combine on top of the best non-stackable
-- one (default: only the single best discount applies). starts_at/ends_at give an
-- optional schedule; `code` is reserved for future coupon entry (auto-apply if NULL).
-- Run ONCE (MariaDB 10.6 / MySQL 8.0). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS page_discounts (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  account_id        INT NOT NULL,
  name              VARCHAR(255) NOT NULL,
  description       TEXT NULL,
  active            TINYINT(1) NOT NULL DEFAULT 1,
  value_type        ENUM('fixed', 'percent') NOT NULL,
  value             DECIMAL(12, 2) NOT NULL,            -- amount (fixed) or percent (percent)
  percent_cap       DECIMAL(12, 2) NULL,                -- max money off when percent; NULL = no cap
  scope             ENUM('all', 'category', 'product', 'cart_item_count', 'product_qty', 'min_order_amount') NOT NULL,
  target_category   VARCHAR(120) NULL,                  -- scope = category
  target_product_id INT NULL,                           -- scope = product / product_qty
  threshold_qty     INT NULL,                           -- scope = cart_item_count / product_qty
  min_amount        DECIMAL(12, 2) NULL,                -- scope = min_order_amount
  applies_to        ENUM('order', 'matching_items') NOT NULL DEFAULT 'order',
  stackable         TINYINT(1) NOT NULL DEFAULT 0,
  priority          INT NOT NULL DEFAULT 0,
  starts_at         DATETIME NULL,
  ends_at           DATETIME NULL,
  code              VARCHAR(60) NULL,                   -- reserved: auto-apply when NULL
  created_by        INT NULL,
  updated_by        INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pd_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_pd_product FOREIGN KEY (target_product_id) REFERENCES page_products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pd_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pd_editor  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_pd_account (account_id, active, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
