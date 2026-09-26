CREATE TABLE IF NOT EXISTS screenshot_template_designs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    template_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    document_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
    updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS screenshot_template_designs_workspace_updated_idx
ON screenshot_template_designs(workspace_id, updated_at);
