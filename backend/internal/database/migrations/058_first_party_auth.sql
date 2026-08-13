CREATE TABLE IF NOT EXISTS email_verification_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  sent_at DATETIME,
  consumed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS email_verification_challenges_user_idx
  ON email_verification_challenges (user_id, created_at);

CREATE INDEX IF NOT EXISTS email_verification_challenges_expiry_idx
  ON email_verification_challenges (expires_at, consumed_at);
