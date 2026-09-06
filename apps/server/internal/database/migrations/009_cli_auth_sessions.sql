-- 009: Add CLI device-flow authorization sessions.

CREATE TABLE IF NOT EXISTS cli_auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    device_code_hash TEXT NOT NULL UNIQUE,
    user_code_hash TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_version TEXT,
    client_os TEXT,
    requested_scopes TEXT NOT NULL DEFAULT 'cli:full',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
    interval_seconds INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMP NOT NULL,
    last_polled_at TIMESTAMP,
    approved_at TIMESTAMP,
    denied_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cli_auth_sessions_user_id_idx
    ON cli_auth_sessions (user_id);

CREATE INDEX IF NOT EXISTS cli_auth_sessions_status_expires_at_idx
    ON cli_auth_sessions (status, expires_at);
