CREATE TABLE IF NOT EXISTS user_impersonation_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  admin_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_ip_address TEXT NOT NULL DEFAULT '',
  created_user_agent TEXT NOT NULL DEFAULT '',
  consumed_ip_address TEXT NOT NULL DEFAULT '',
  consumed_user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_impersonation_grants_admin_created_idx
  ON user_impersonation_grants (admin_user_id, created_at);

CREATE INDEX IF NOT EXISTS user_impersonation_grants_target_created_idx
  ON user_impersonation_grants (target_user_id, created_at);

CREATE INDEX IF NOT EXISTS user_impersonation_grants_expiry_idx
  ON user_impersonation_grants (expires_at) WHERE used_at IS NULL;
