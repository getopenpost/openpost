-- Unknown historical fetch dates stay NULL so retention cannot extend them.
ALTER TABLE social_accounts ADD COLUMN profile_fetched_at TIMESTAMP;
CREATE INDEX idx_youtube_profile_refresh ON social_accounts(profile_fetched_at) WHERE platform = 'youtube' AND is_active = TRUE;
