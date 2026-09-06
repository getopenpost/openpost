CREATE TABLE IF NOT EXISTS provider_installations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    protocol_version TEXT NOT NULL DEFAULT '',
    implementation_version TEXT NOT NULL DEFAULT '',
    capability_revision TEXT NOT NULL DEFAULT '',
    manifest_json TEXT NOT NULL DEFAULT '{}',
    config_fingerprint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    status_detail TEXT NOT NULL DEFAULT '',
    required BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (kind IN ('builtin', 'connector')),
    CHECK (provider_id <> ''),
    CHECK (display_name <> ''),
    CHECK (status IN ('available', 'unavailable', 'invalid_config', 'invalid_manifest', 'disabled'))
);

CREATE INDEX IF NOT EXISTS provider_installations_provider_idx
    ON provider_installations (provider_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_connector_binding_owner_idx
    ON social_accounts (id, workspace_id);

CREATE TABLE IF NOT EXISTS provider_account_bindings (
    social_account_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    connection_ref TEXT NOT NULL DEFAULT '',
    external_account_id TEXT NOT NULL,
    capability_revision TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (social_account_id, workspace_id)
        REFERENCES social_accounts(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (installation_id) REFERENCES provider_installations(id) ON DELETE RESTRICT,
    UNIQUE (workspace_id, installation_id, external_account_id),
    CHECK (external_account_id <> '')
);

CREATE INDEX IF NOT EXISTS provider_account_bindings_installation_idx
    ON provider_account_bindings (installation_id, workspace_id);

CREATE TABLE IF NOT EXISTS connector_connection_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    state TEXT NOT NULL,
    connection_ref TEXT NOT NULL DEFAULT '',
    accounts_json TEXT NOT NULL DEFAULT '[]',
    error_kind TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (installation_id) REFERENCES provider_installations(id) ON DELETE RESTRICT,
    CHECK (state IN ('pending', 'complete', 'failed', 'canceled', 'expired'))
);

CREATE INDEX IF NOT EXISTS connector_connection_sessions_workspace_idx
    ON connector_connection_sessions (workspace_id, state, expires_at);
