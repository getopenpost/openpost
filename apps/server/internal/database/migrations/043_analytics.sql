CREATE TABLE IF NOT EXISTS analytics_account_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  captured_at TIMESTAMP NOT NULL,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_account_snapshots_account_captured_idx
  ON analytics_account_snapshots (social_account_id, captured_at);

CREATE INDEX IF NOT EXISTS analytics_account_snapshots_workspace_captured_idx
  ON analytics_account_snapshots (workspace_id, captured_at);

CREATE TABLE IF NOT EXISTS analytics_rendition_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  captured_at TIMESTAMP NOT NULL,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE,
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_rendition_snapshots_rendition_captured_idx
  ON analytics_rendition_snapshots (rendition_id, captured_at);

CREATE INDEX IF NOT EXISTS analytics_rendition_snapshots_workspace_captured_idx
  ON analytics_rendition_snapshots (workspace_id, captured_at);

CREATE TABLE IF NOT EXISTS analytics_sync_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  next_sync_at TIMESTAMP,
  unchanged_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS analytics_sync_states_due_idx
  ON analytics_sync_states (status, next_sync_at);

CREATE INDEX IF NOT EXISTS analytics_sync_states_workspace_idx
  ON analytics_sync_states (workspace_id, subject_type);
