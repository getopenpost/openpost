CREATE TABLE editor_ai_calls (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    requested_model TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    provider_request_id TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL,
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    cost_microusd BIGINT,
    created_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    UNIQUE(run_id, step)
);
CREATE INDEX editor_ai_calls_workspace ON editor_ai_calls(workspace_id, created_at);

CREATE TABLE editor_preferences (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL DEFAULT '',
    editor_kind TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    rule TEXT NOT NULL,
    source_instruction TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    revision INTEGER NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
CREATE INDEX editor_preferences_owner ON editor_preferences(workspace_id, owner_id, project_id);

CREATE TABLE editor_styles (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    editor_kind TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    definition_json TEXT NOT NULL,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    source_instruction TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY(id, version)
);
CREATE INDEX editor_styles_owner ON editor_styles(workspace_id, owner_id, name);

CREATE TABLE editor_learning_settings (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY(workspace_id, user_id)
);

CREATE TABLE editor_library_choices (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    entry_id TEXT NOT NULL,
    entry_name TEXT NOT NULL,
    editor_kind TEXT NOT NULL,
    last_used_at TIMESTAMP NOT NULL,
    PRIMARY KEY(workspace_id, user_id, project_id, context, entry_id)
);

CREATE TABLE editor_library_favorites (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    entry_name TEXT NOT NULL,
    editor_kind TEXT NOT NULL,
    device_local BOOLEAN NOT NULL,
    favorite BOOLEAN NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY(workspace_id, user_id, entry_id)
);
