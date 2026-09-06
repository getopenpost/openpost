CREATE TABLE IF NOT EXISTS growth_recommendations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  remote_account_id TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  followers_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  mutual_count INTEGER NOT NULL DEFAULT 0,
  mutuals_json TEXT NOT NULL DEFAULT '[]',
  mutual_exact BOOLEAN NOT NULL DEFAULT FALSE,
  follows_viewer BOOLEAN NOT NULL DEFAULT FALSE,
  signals_json TEXT NOT NULL DEFAULT '[]',
  score REAL NOT NULL DEFAULT 0,
  generation_id TEXT NOT NULL,
  dismissed_at TIMESTAMP,
  follow_state TEXT NOT NULL DEFAULT 'idle',
  follow_error_code TEXT NOT NULL DEFAULT '',
  follow_error_message TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (social_account_id, remote_account_id)
);

CREATE INDEX IF NOT EXISTS growth_recommendations_workspace_idx
  ON growth_recommendations (workspace_id);

CREATE INDEX IF NOT EXISTS growth_recommendations_social_account_idx
  ON growth_recommendations (social_account_id);

CREATE INDEX IF NOT EXISTS growth_recommendations_generation_idx
  ON growth_recommendations (social_account_id, generation_id);

CREATE INDEX IF NOT EXISTS growth_recommendations_score_idx
  ON growth_recommendations (social_account_id, generation_id, score DESC);

CREATE TABLE IF NOT EXISTS growth_sync_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  current_generation_id TEXT NOT NULL DEFAULT '',
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (social_account_id)
);

CREATE INDEX IF NOT EXISTS growth_sync_states_workspace_idx
  ON growth_sync_states (workspace_id);

CREATE INDEX IF NOT EXISTS growth_sync_states_social_account_idx
  ON growth_sync_states (social_account_id);
