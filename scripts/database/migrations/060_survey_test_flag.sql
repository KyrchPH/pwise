-- "Send test survey" support for Settings → Customer surveys.
-- Admins can send a real survey email to a chosen address to confirm the pipe works
-- (SMTP → email → link → response tracking). Those rows are flagged is_test = 1 so they
-- stay fully observable (not silent, not day-lagged) yet are excluded from the honest
-- CSAT/NPS aggregates in surveys.service.summary(). Test rows carry conversation_id = NULL
-- and email_source = 'test'.

ALTER TABLE conversation_surveys
  ADD COLUMN is_test TINYINT(1) NOT NULL DEFAULT 0 AFTER email_source;
