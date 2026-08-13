CREATE TABLE IF NOT EXISTS oauth_grants (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_project_id TEXT NOT NULL DEFAULT '',
    provider_subject TEXT NOT NULL DEFAULT '',
    instance_url TEXT NOT NULL DEFAULT '',
    access_token_encrypted BLOB NOT NULL,
    refresh_token_encrypted BLOB,
    access_token_expires_at DATETIME,
    refresh_token_expires_at DATETIME,
    granted_scopes TEXT NOT NULL DEFAULT '',
    token_type TEXT NOT NULL DEFAULT '',
    token_version INTEGER NOT NULL DEFAULT 1,
    execution_mode TEXT NOT NULL DEFAULT 'user_oauth',
    authorization_evidence_json TEXT NOT NULL DEFAULT '{}',
    consented_by_id TEXT NOT NULL DEFAULT '',
    consented_at DATETIME,
    validated_at DATETIME,
    validation_status TEXT NOT NULL DEFAULT 'valid',
    refresh_lease_owner TEXT NOT NULL DEFAULT '',
    refresh_lease_expires_at DATETIME,
    last_refresh_started_at DATETIME,
    last_refresh_finished_at DATETIME,
    last_refresh_error TEXT NOT NULL DEFAULT '',
    revoked_by_id TEXT NOT NULL DEFAULT '',
    revocation_reason TEXT NOT NULL DEFAULT '',
    revoked_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT current_timestamp,
    updated_at DATETIME NOT NULL DEFAULT current_timestamp,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oauth_grants_workspace_provider_idx
    ON oauth_grants (workspace_id, provider, revoked_at);

CREATE INDEX IF NOT EXISTS oauth_grants_refresh_due_idx
    ON oauth_grants (access_token_expires_at, revoked_at);
