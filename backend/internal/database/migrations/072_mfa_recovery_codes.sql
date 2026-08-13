CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_mfa_recovery_codes_user_idx
    ON user_mfa_recovery_codes (user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS user_mfa_recovery_codes_active_hash_idx
    ON user_mfa_recovery_codes (user_id, code_hash)
    WHERE used_at IS NULL;
