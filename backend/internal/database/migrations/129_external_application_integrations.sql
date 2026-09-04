CREATE INDEX IF NOT EXISTS api_tokens_installation_id_idx ON api_tokens (installation_id);

CREATE TABLE IF NOT EXISTS external_applications (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  client_secret_hash TEXT NOT NULL DEFAULT '',
  redirect_uris_json TEXT NOT NULL,
  allowed_scopes TEXT NOT NULL,
  created_by_user_id TEXT,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS external_app_installations (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  sponsor_user_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  token_family_id TEXT NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (application_id) REFERENCES external_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (sponsor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS external_app_installations_active_app_user_idx
  ON external_app_installations (application_id, sponsor_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS external_app_workspace_grants (
  installation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  all_current_accounts BOOLEAN NOT NULL DEFAULT FALSE,
  organization_id TEXT NOT NULL DEFAULT '',
  identity_provider_id TEXT NOT NULL DEFAULT '',
  assured_at TIMESTAMP,
  credential_expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (installation_id, workspace_id),
  FOREIGN KEY (installation_id) REFERENCES external_app_installations(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_app_account_grants (
  installation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (installation_id, workspace_id, social_account_id),
  FOREIGN KEY (installation_id, workspace_id) REFERENCES external_app_workspace_grants(installation_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_oauth_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  installation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (installation_id) REFERENCES external_app_installations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS external_oauth_codes_expiry_idx ON external_oauth_codes (expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS external_refresh_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (installation_id) REFERENCES external_app_installations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS external_refresh_tokens_family_idx ON external_refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS external_webhook_subscriptions (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  secret_encrypted BLOB NOT NULL,
  event_types TEXT NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (installation_id, workspace_id) REFERENCES external_app_workspace_grants(installation_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (subscription_id, event_id),
  FOREIGN KEY (subscription_id) REFERENCES external_webhook_subscriptions(id) ON DELETE CASCADE
);
