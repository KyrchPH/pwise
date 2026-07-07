-- =====================================================================
-- Migration 050 — Orders, agreements & receipts
-- The post-cart checkout flow. A staff member reviews the cart, fills the customer's
-- delivery details and generates an IMMUTABLE agreement (order_agreements) — a snapshot
-- of the line items + applied discounts + server-recomputed totals, shared with the
-- customer via an unguessable `token` (public /agreement/:token). It expires 30 minutes
-- after creation; when the customer ticks the sworn-statement box and confirms, the
-- agreement becomes 'confirmed' and a real `orders` row (+ order_items / order_discounts)
-- is created. Orders and receipts are owner-scoped (created_by) with admin bypass.
-- Run ONCE (MariaDB 10.6 / MySQL 8.0). Additive — safe.
-- NOTE: the effective apply path is database/schema.sql (migrate.js loads only that);
-- these same statements are appended there.
-- =====================================================================

CREATE TABLE IF NOT EXISTS order_agreements (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  token            CHAR(40) NOT NULL,                   -- crypto-random hex; the public-link capability
  account_id       INT NOT NULL,                        -- page scope
  created_by       INT NULL,                            -- owner (staff who drafted it)
  created_by_name  VARCHAR(255) NULL,
  currency         VARCHAR(8) NOT NULL DEFAULT 'PHP',
  customer_name    VARCHAR(255) NOT NULL,
  delivery_address TEXT NOT NULL,
  contact_number   VARCHAR(60) NOT NULL,
  email            VARCHAR(255) NULL,
  notes            TEXT NULL,
  language         VARCHAR(8) NOT NULL DEFAULT 'en',
  items            JSON NOT NULL,                        -- [{productId,variantId,name,variantLabel,unitPrice,quantity,category,media}]
  discounts        JSON NOT NULL,                        -- applied [{id,name,amount}]
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_discount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  total            DECIMAL(12,2) NOT NULL DEFAULT 0,
  status           ENUM('active','confirmed','expired','cancelled') NOT NULL DEFAULT 'active',
  expires_at       DATETIME NOT NULL,
  first_viewed_at  DATETIME NULL,
  last_viewed_at   DATETIME NULL,
  confirmed_at     DATETIME NULL,
  order_id         INT NULL,                             -- set on confirm (no FK: orders is created after)
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_oa_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_oa_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_oa_token (token),
  INDEX idx_oa_account (account_id, created_by, id),
  INDEX idx_oa_status (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  agreement_id     INT NULL,
  account_id       INT NOT NULL,
  created_by       INT NULL,                             -- owner (admins bypass)
  created_by_name  VARCHAR(255) NULL,
  currency         VARCHAR(8) NOT NULL DEFAULT 'PHP',
  customer_name    VARCHAR(255) NOT NULL,
  delivery_address TEXT NOT NULL,
  contact_number   VARCHAR(60) NOT NULL,
  email            VARCHAR(255) NULL,
  notes            TEXT NULL,
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_discount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  total            DECIMAL(12,2) NOT NULL DEFAULT 0,
  status           ENUM('pending','paid','processing','ready_for_pickup','shipped','out_for_delivery','completed','cancelled') NOT NULL DEFAULT 'pending',
  confirmed_at     DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ord_account   FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ord_agreement FOREIGN KEY (agreement_id) REFERENCES order_agreements(id) ON DELETE SET NULL,
  CONSTRAINT fk_ord_creator   FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ord_account (account_id, created_by, id),
  INDEX idx_ord_status (account_id, status, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_id      INT NOT NULL,
  product_id    INT NULL,                                -- reference only; the rest are value snapshots
  name          VARCHAR(255) NOT NULL,
  variant_label VARCHAR(255) NULL,
  unit_price    DECIMAL(12,2) NULL,                      -- NULL = quote item
  quantity      INT NOT NULL DEFAULT 1,
  line_total    DECIMAL(12,2) NULL,
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_oi_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_discounts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  order_id    INT NOT NULL,
  discount_id INT NULL,
  name        VARCHAR(255) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_od_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_od_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  account_id      INT NOT NULL,
  created_by      INT NULL,                              -- owner (admins bypass)
  created_by_name VARCHAR(255) NULL,
  title           VARCHAR(255) NULL,
  s3_key          VARCHAR(512) NOT NULL,                 -- private S3 object, presigned on read
  content_type    VARCHAR(120) NULL,
  file_size       INT NULL,
  note            TEXT NULL,
  order_id        INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rcpt_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_rcpt_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_rcpt_order   FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  INDEX idx_rcpt_account (account_id, created_by, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
