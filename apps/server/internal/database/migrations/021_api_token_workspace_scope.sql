ALTER TABLE api_tokens ADD COLUMN workspace_id TEXT;

CREATE INDEX IF NOT EXISTS api_tokens_workspace_id_idx
  ON api_tokens (workspace_id);

ALTER TABLE mcp_oauth_codes ADD COLUMN workspace_id TEXT;

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_workspace_id_idx
  ON mcp_oauth_codes (workspace_id);
