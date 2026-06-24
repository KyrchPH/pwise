-- =====================================================================
-- Migration 035 — Product option-matrix variants
-- Adds dynamic per-variant pricing to page_products. A product can define option
-- axes (e.g. Size, Scent) in the new `options` JSON column; the app generates one
-- row per combination in page_product_variants, each with its own price + photo.
-- A product with no options stays "simple" and keeps using page_products.base_price.
-- The variant photo is a STABLE S3 key (the API presigns it on read), exactly like
-- the product photo. combo_key is the canonical "Axis=Value|Axis=Value" identity
-- (in axis order) so a combination's price/photo survive edits to OTHER axes.
-- Run ONCE (MariaDB 10.6 / MySQL 8.0). Additive — safe.
-- =====================================================================

ALTER TABLE page_products
  ADD COLUMN options JSON NULL AFTER tags;   -- [{"name":"Size","values":["1L","5L"]}, ...]

CREATE TABLE IF NOT EXISTS page_product_variants (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  product_id    INT NOT NULL,
  combo_key     VARCHAR(255) NOT NULL,        -- canonical "Size=1L|Scent=Lemon"
  option_values JSON NOT NULL,                -- {"Size":"1L","Scent":"Lemon"}
  price         DECIMAL(12, 2) NULL,          -- NULL = "Quote" for this combination
  photo_key     VARCHAR(512) NULL,            -- stable S3 key (API presigns on read)
  active        TINYINT(1) NOT NULL DEFAULT 1,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ppv_product FOREIGN KEY (product_id) REFERENCES page_products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ppv_combo (product_id, combo_key),
  INDEX idx_ppv_product (product_id, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
