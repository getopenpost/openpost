ALTER TABLE social_accounts
  ADD COLUMN capability_state_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE social_accounts
  ADD COLUMN capability_checked_at TIMESTAMP;
