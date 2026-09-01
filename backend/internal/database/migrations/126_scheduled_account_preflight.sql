ALTER TABLE social_accounts ADD COLUMN preflight_checked_at DATETIME;
ALTER TABLE social_accounts ADD COLUMN preflight_success_at DATETIME;
ALTER TABLE social_accounts ADD COLUMN preflight_warned_at DATETIME;
ALTER TABLE social_accounts ADD COLUMN preflight_failure TEXT NOT NULL DEFAULT '';
