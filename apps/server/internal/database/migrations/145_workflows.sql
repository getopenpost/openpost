CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    published_revision INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    draft_json TEXT NOT NULL,
    published_json TEXT NOT NULL DEFAULT '{}',
    authority_json TEXT NOT NULL DEFAULT '{}',
    source_fingerprint TEXT NOT NULL DEFAULT '',
    source_initialized BOOLEAN NOT NULL DEFAULT FALSE,
    source_error TEXT NOT NULL DEFAULT '',
    last_checked_at TIMESTAMP,
    source_started_at TIMESTAMP,
    source_page INTEGER NOT NULL DEFAULT 1,
    poll_lease_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
CREATE INDEX workflows_workspace ON workflows(workspace_id, updated_at);
CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    workflow_name TEXT NOT NULL,
    workflow_revision INTEGER NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    definition_json TEXT NOT NULL,
    authority_json TEXT NOT NULL,
    source_json TEXT NOT NULL,
    remaining_json TEXT NOT NULL,
    results_json TEXT NOT NULL DEFAULT '[]',
    current_step_id TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    wake_at TIMESTAMP,
    lease_token TEXT NOT NULL DEFAULT '',
    lease_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
CREATE INDEX workflow_runs_workspace ON workflow_runs(workspace_id, created_at);
CREATE INDEX workflow_runs_workflow ON workflow_runs(workflow_id, created_at);
CREATE INDEX workflow_runs_wake ON workflow_runs(state, wake_at);
CREATE TABLE workflow_events (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_fingerprint TEXT NOT NULL,
    event_key TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (workflow_id, source_fingerprint, event_key)
);
CREATE TABLE workflow_connections (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    ciphertext BYTEA NOT NULL,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX workflow_connections_workspace ON workflow_connections(workspace_id);
