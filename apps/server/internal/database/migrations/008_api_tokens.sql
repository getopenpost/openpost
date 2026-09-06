-- 008: Add first-class opaque API tokens for CLI and automation clients.

CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'cli:full',
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx
    ON api_tokens (user_id);

CREATE INDEX IF NOT EXISTS api_tokens_token_prefix_idx
    ON api_tokens (token_prefix);

CREATE INDEX IF NOT EXISTS api_tokens_active_idx
    ON api_tokens (user_id, revoked_at, expires_at);
