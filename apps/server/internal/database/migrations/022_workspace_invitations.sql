CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  invited_by_user_id TEXT NOT NULL,
  accepted_by_user_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME,
  revoked_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_status_idx
  ON workspace_invitations (workspace_id, accepted_at, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS workspace_invitations_email_idx
  ON workspace_invitations (workspace_id, email);
