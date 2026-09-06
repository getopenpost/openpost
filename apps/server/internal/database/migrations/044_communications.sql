CREATE TABLE IF NOT EXISTS engagement_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  parent_remote_id TEXT NOT NULL DEFAULT '',
  conversation_remote_id TEXT NOT NULL DEFAULT '',
  author_remote_id TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  author_handle TEXT NOT NULL DEFAULT '',
  author_avatar_url TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  is_ours BOOLEAN NOT NULL DEFAULT FALSE,
  can_reply BOOLEAN NOT NULL DEFAULT FALSE,
  can_hide BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,
  archived_at TIMESTAMP,
  remote_created_at TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (social_account_id, remote_id)
);

CREATE INDEX IF NOT EXISTS engagement_items_workspace_inbox_idx
  ON engagement_items (workspace_id, archived_at, remote_created_at);

CREATE INDEX IF NOT EXISTS engagement_items_rendition_idx
  ON engagement_items (rendition_id, remote_created_at);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  remote_conversation_id TEXT NOT NULL,
  counterpart_remote_id TEXT NOT NULL DEFAULT '',
  counterpart_name TEXT NOT NULL DEFAULT '',
  counterpart_handle TEXT NOT NULL DEFAULT '',
  counterpart_avatar_url TEXT NOT NULL DEFAULT '',
  last_message_at TIMESTAMP,
  last_message_preview TEXT NOT NULL DEFAULT '',
  last_remote_message_id TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  read_at TIMESTAMP,
  archived_at TIMESTAMP,
  messaging_window_expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (social_account_id, remote_conversation_id)
);

CREATE INDEX IF NOT EXISTS conversations_workspace_inbox_idx
  ON conversations (workspace_id, archived_at, last_message_at);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  remote_message_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  author_remote_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  send_status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT NOT NULL DEFAULT '',
  remote_created_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS direct_messages_remote_idx
  ON direct_messages (conversation_id, remote_message_id)
  WHERE remote_message_id <> '';

CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx
  ON direct_messages (conversation_id, remote_created_at, created_at);

CREATE TABLE IF NOT EXISTS communication_sync_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('engagement', 'messages')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  cursor TEXT NOT NULL DEFAULT '',
  backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  next_sync_at TIMESTAMP,
  empty_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (capability, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS communication_sync_states_due_idx
  ON communication_sync_states (capability, status, next_sync_at);

CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications (user_id, created_at);

CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON user_notifications (user_id, read_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_dedup_idx
  ON user_notifications (user_id, dedup_key)
  WHERE dedup_key <> '';

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id TEXT PRIMARY KEY,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
