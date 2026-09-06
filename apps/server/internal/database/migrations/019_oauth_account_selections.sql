CREATE TABLE IF NOT EXISTS oauth_account_selections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  instance_url TEXT,
  access_token_encrypted BLOB NOT NULL,
  refresh_token_encrypted BLOB,
  token_type TEXT,
  token_expires_at TIMESTAMP,
  token_extra_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '[]',
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oauth_account_selections_user_idx
  ON oauth_account_selections (user_id, expires_at);

CREATE INDEX IF NOT EXISTS oauth_account_selections_workspace_idx
  ON oauth_account_selections (workspace_id, platform);
