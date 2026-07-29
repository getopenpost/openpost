ALTER TABLE api_tokens ADD COLUMN audience TEXT;

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'mcp:full',
  resource TEXT,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_user_created_idx
  ON mcp_oauth_codes (user_id, created_at);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry_idx
  ON mcp_oauth_codes (expires_at, consumed_at);
