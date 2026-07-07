-- Per-page default first message for the "message a commenter" (Comment → DM) flow.
-- NULL/blank means the docked composer opens empty. Surfaced on the page object (toSafe)
-- so the client can prefill it; the actual private reply sends whatever the agent submits.
ALTER TABLE platform_accounts
  ADD COLUMN comment_dm_default_message TEXT NULL;
