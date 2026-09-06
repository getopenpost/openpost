CREATE TABLE IF NOT EXISTS provider_media_states (
  post_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_media_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (post_id, social_account_id, media_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_media_states_account_status_idx
  ON provider_media_states (social_account_id, status);

CREATE INDEX IF NOT EXISTS provider_media_states_media_idx
  ON provider_media_states (media_id);
