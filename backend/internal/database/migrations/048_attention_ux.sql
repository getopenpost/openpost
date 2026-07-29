ALTER TABLE engagement_items
  ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE engagement_items
  ADD COLUMN edited_at TIMESTAMP;

ALTER TABLE engagement_items
  ADD COLUMN deleted_at TIMESTAMP;

ALTER TABLE engagement_items
  ADD COLUMN can_like BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE engagement_items
  ADD COLUMN can_unlike BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE engagement_items
  ADD COLUMN liked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS engagement_items_workspace_attention_idx
  ON engagement_items (workspace_id, deleted_at, read_at, remote_created_at);

ALTER TABLE analytics_account_snapshots
  ADD COLUMN capture_key TEXT NOT NULL DEFAULT '';

ALTER TABLE analytics_rendition_snapshots
  ADD COLUMN capture_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS analytics_account_snapshots_capture_key_idx
  ON analytics_account_snapshots (social_account_id, capture_key)
  WHERE capture_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS analytics_rendition_snapshots_capture_key_idx
  ON analytics_rendition_snapshots (rendition_id, capture_key)
  WHERE capture_key <> '';

CREATE TABLE IF NOT EXISTS feedback_rate_limit_windows (
  user_id TEXT NOT NULL,
  window_start TIMESTAMP NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (user_id, window_start),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS feedback_rate_limit_windows_start_idx
  ON feedback_rate_limit_windows (window_start);
