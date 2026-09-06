CREATE TABLE IF NOT EXISTS user_notification_mutes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  workspace_id TEXT,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CHECK (scope IN ('account', 'workspace')),
  CHECK ((scope = 'account' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL)),
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_notification_mutes_scope_idx
  ON user_notification_mutes (user_id, scope, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_notification_mutes_account_idx
  ON user_notification_mutes (user_id)
  WHERE scope = 'account';

CREATE INDEX IF NOT EXISTS user_notification_mutes_active_idx
  ON user_notification_mutes (user_id, workspace_id, ends_at)
  WHERE ended_at IS NULL;

ALTER TABLE user_notification_digest_items
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';

ALTER TABLE user_notification_digest_items
  ADD COLUMN workspace_scope_known BOOLEAN NOT NULL DEFAULT FALSE;
