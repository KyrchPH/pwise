-- Per-page email sender credentials for customer satisfaction surveys.
-- The app password is encrypted at rest (same ENCRYPTION_KEY flow as page tokens).

ALTER TABLE platform_accounts
  ADD COLUMN survey_sender_email VARCHAR(255) NULL AFTER survey_config,
  ADD COLUMN survey_sender_name VARCHAR(255) NULL AFTER survey_sender_email,
  ADD COLUMN survey_sender_app_password TEXT NULL AFTER survey_sender_name;
