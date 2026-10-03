CREATE TABLE editor_agent_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    editor_kind TEXT NOT NULL,
    epoch TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX editor_agent_sessions_workspace_live
    ON editor_agent_sessions(workspace_id, expires_at);

CREATE TABLE editor_agent_requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES editor_agent_sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    caller_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    arguments_json TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}',
    error_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    lease_until TIMESTAMP,
    UNIQUE(workspace_id, caller_user_id, request_key)
);

CREATE INDEX editor_agent_requests_delivery
    ON editor_agent_requests(session_id, status, created_at);
