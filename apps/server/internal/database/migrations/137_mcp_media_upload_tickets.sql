CREATE TABLE mcp_media_upload_tickets (
    id TEXT PRIMARY KEY,
    ticket_hash TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT,
    token_id TEXT,
    client_id TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT,
    size BIGINT NOT NULL,
    alt_text TEXT,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_mcp_media_upload_tickets_expiry
    ON mcp_media_upload_tickets (expires_at);
