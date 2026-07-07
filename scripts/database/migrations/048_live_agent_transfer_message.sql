-- Per-page message the app sends to the customer when the AI hands the conversation to a
-- live agent (the "Transfer to Human" tool). NULL/blank → a built-in default is used.
-- Surfaced on the page object (toSafe) so admins can configure it in Settings → Pages.
-- Sent deterministically by the app (messaging.handoffToLiveAgent), not by the LLM, so the
-- customer is always notified — including the online case where a post-handoff AI message
-- would be suppressed by the "don't talk over a human" guard.
ALTER TABLE platform_accounts
  ADD COLUMN live_agent_transfer_message TEXT NULL;
