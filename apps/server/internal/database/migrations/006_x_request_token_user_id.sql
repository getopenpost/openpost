CREATE TABLE IF NOT EXISTS x_oauth_request_tokens (
    request_token TEXT PRIMARY KEY,
    request_secret TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

ALTER TABLE x_oauth_request_tokens ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
