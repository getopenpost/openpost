CREATE TABLE IF NOT EXISTS bot_connection_nonces (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (provider <> '' AND LENGTH(provider) <= 32),
  CHECK (nonce_hash <> '' AND LENGTH(nonce_hash) = 64)
);

CREATE INDEX IF NOT EXISTS bot_connection_nonces_active_idx
  ON bot_connection_nonces (provider, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_ingress_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_id TEXT,
  social_account_id TEXT NOT NULL DEFAULT '',
  connection_nonce_id TEXT NOT NULL DEFAULT '',
  subject_reference TEXT NOT NULL DEFAULT '',
  parent_reference TEXT NOT NULL DEFAULT '',
  occurred_at DATETIME NOT NULL,
  processed_at DATETIME,
  safe_error_code TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE (provider, provider_event_id),
  CHECK (provider <> '' AND LENGTH(provider) <= 32),
  CHECK (provider_event_id <> '' AND LENGTH(provider_event_id) <= 200),
  CHECK (kind <> '' AND LENGTH(kind) <= 64),
  CHECK (LENGTH(workspace_id) <= 200),
  CHECK (LENGTH(social_account_id) <= 200),
  CHECK (LENGTH(connection_nonce_id) <= 200),
  CHECK (LENGTH(subject_reference) <= 500),
  CHECK (LENGTH(parent_reference) <= 500),
  CHECK (LENGTH(safe_error_code) <= 64)
);

CREATE INDEX IF NOT EXISTS bot_ingress_events_pending_idx
  ON bot_ingress_events (provider, created_at)
  WHERE processed_at IS NULL;
