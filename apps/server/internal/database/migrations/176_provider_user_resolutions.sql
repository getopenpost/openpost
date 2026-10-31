CREATE TABLE provider_user_resolutions (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 handle TEXT NOT NULL,
 provider_user_id TEXT NOT NULL,
 resolved_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE (provider, workspace_id, handle)
);
