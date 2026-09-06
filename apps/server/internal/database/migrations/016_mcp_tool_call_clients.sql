ALTER TABLE mcp_tool_calls ADD COLUMN client_id TEXT;
ALTER TABLE mcp_tool_calls ADD COLUMN client_name TEXT;
ALTER TABLE mcp_tool_calls ADD COLUMN client_scope TEXT;
ALTER TABLE mcp_tool_calls ADD COLUMN client_token_prefix TEXT;

CREATE INDEX IF NOT EXISTS mcp_tool_calls_client_created_idx
  ON mcp_tool_calls (client_id, created_at);
