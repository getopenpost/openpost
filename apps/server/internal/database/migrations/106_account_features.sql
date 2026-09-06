CREATE TABLE IF NOT EXISTS account_features (
  social_account_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('messaging','engagement','analytics','grow')),
  enabled BOOLEAN NOT NULL,
  decided_by_user_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (social_account_id, feature),
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS account_features_workspace_idx ON account_features (workspace_id);
CREATE INDEX IF NOT EXISTS account_features_feature_idx ON account_features (feature);
CREATE INDEX IF NOT EXISTS account_features_workspace_feature_idx ON account_features (workspace_id, feature);
