ALTER TABLE users ADD COLUMN terms_version TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN privacy_version TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN legal_accepted_at DATETIME;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
  ON password_reset_tokens(expires_at);
