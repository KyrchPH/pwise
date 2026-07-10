-- Links an order (and the agreement it was created from) back to the conversation
-- that produced the sale, so "sales per conversation" can be measured. The id is
-- captured when checkout is started from the inbox; it stays NULL for Shop-only
-- orders that have no chat origin. ON DELETE SET NULL so removing a conversation
-- never destroys the sale record — it just loses its attribution.

ALTER TABLE order_agreements
  ADD COLUMN conversation_id INT NULL AFTER account_id,
  ADD CONSTRAINT fk_oa_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  ADD INDEX idx_oa_conversation (conversation_id);

ALTER TABLE orders
  ADD COLUMN conversation_id INT NULL AFTER account_id,
  ADD CONSTRAINT fk_ord_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  ADD INDEX idx_ord_conversation (conversation_id);
