-- =====================================================================
-- Migration 051 - Shop terms & conditions on the order agreement
-- A page/shop gets one Terms & Conditions block (order_terms), edited in
-- Settings → Facebook Pages → Edit. At checkout the block is SNAPSHOTTED into the
-- agreement (order_agreements.terms) so the customer's immutable copy shows the
-- exact terms in force when the agreement was generated — later edits to the shop
-- terms don't change already-issued agreements. Both columns are nullable/optional
-- (a shop with no terms simply shows none). Run once. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN order_terms TEXT NULL;

ALTER TABLE order_agreements
  ADD COLUMN terms TEXT NULL;
