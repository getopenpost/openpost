CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_user_created_idx
  ON mcp_tool_calls (user_id, created_at);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_workspace_created_idx
  ON mcp_tool_calls (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_tool_status_idx
  ON mcp_tool_calls (tool_name, status);
