CREATE TABLE IF NOT EXISTS repost_policies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  delay_seconds INTEGER NOT NULL DEFAULT 86400,
  evaluation_window_seconds INTEGER NOT NULL DEFAULT 604800,
  threshold_mode TEXT NOT NULL DEFAULT 'all',
  min_likes BIGINT NOT NULL DEFAULT 0,
  min_comments BIGINT NOT NULL DEFAULT 0,
  min_reposts BIGINT NOT NULL DEFAULT 0,
  min_views BIGINT NOT NULL DEFAULT 0,
  require_plateau BOOLEAN NOT NULL DEFAULT false,
  plateau_checks INTEGER NOT NULL DEFAULT 2,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS repost_policies_workspace_idx
  ON repost_policies (workspace_id, enabled);

CREATE TABLE IF NOT EXISTS repost_policy_accounts (
  policy_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (policy_id, social_account_id, role),
  FOREIGN KEY (policy_id) REFERENCES repost_policies(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS repost_policy_accounts_account_idx
  ON repost_policy_accounts (social_account_id, role);

CREATE TABLE IF NOT EXISTS repost_account_grants (
  id TEXT PRIMARY KEY,
  source_workspace_id TEXT NOT NULL,
  target_workspace_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  revoked_by TEXT,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (source_workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (target_workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (target_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS repost_account_grants_active_unique_idx
  ON repost_account_grants (source_workspace_id, target_account_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS repost_account_grants_target_workspace_idx
  ON repost_account_grants (target_workspace_id, revoked_at);

CREATE TABLE IF NOT EXISTS repost_executions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  source_account_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  policy_id TEXT,
  rule_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  eligible_after TIMESTAMP NOT NULL,
  deadline_at TIMESTAMP NOT NULL,
  next_check_at TIMESTAMP,
  check_count INTEGER NOT NULL DEFAULT 0,
  last_metrics_json TEXT NOT NULL DEFAULT '{}',
  external_id TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE,
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (target_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (policy_id) REFERENCES repost_policies(id) ON DELETE SET NULL,
  UNIQUE (rendition_id, target_account_id)
);

CREATE INDEX IF NOT EXISTS repost_executions_due_idx
  ON repost_executions (status, next_check_at);

CREATE INDEX IF NOT EXISTS repost_executions_workspace_idx
  ON repost_executions (workspace_id, created_at);
