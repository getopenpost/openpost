ALTER TABLE social_set_accounts ADD COLUMN default_settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE social_set_accounts ADD COLUMN default_segment_settings_json TEXT NOT NULL DEFAULT '{}';
