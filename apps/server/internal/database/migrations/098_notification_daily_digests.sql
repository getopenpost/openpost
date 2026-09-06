CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id TEXT PRIMARY KEY,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  digest_time TEXT NOT NULL DEFAULT '09:00',
  digest_timezone TEXT NOT NULL DEFAULT '',
  digest_configured BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE user_notification_preferences
  ADD COLUMN digest_time TEXT NOT NULL DEFAULT '09:00';

ALTER TABLE user_notification_preferences
  ADD COLUMN digest_timezone TEXT NOT NULL DEFAULT '';

ALTER TABLE user_notification_preferences
  ADD COLUMN digest_configured BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_notification_digest_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '',
  dedup_key TEXT NOT NULL DEFAULT '',
  delivery_window_at TIMESTAMP NOT NULL,
  delivery_id TEXT NOT NULL DEFAULT '',
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS user_notification_digest_items_dedup_idx
  ON user_notification_digest_items (user_id, dedup_key)
  WHERE dedup_key <> '';

CREATE INDEX IF NOT EXISTS user_notification_digest_items_window_idx
  ON user_notification_digest_items (user_id, delivery_window_at, delivery_id, delivered_at);
