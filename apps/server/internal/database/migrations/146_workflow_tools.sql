ALTER TABLE workflow_connections ADD COLUMN host TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_connections ADD COLUMN header_name TEXT NOT NULL DEFAULT '';
CREATE TABLE workflow_effects (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 step_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 state TEXT NOT NULL,
 output_json TEXT NOT NULL DEFAULT '{}',
 created_at TIMESTAMP NOT NULL,
 updated_at TIMESTAMP NOT NULL,
 PRIMARY KEY (run_id, step_id)
);
CREATE TABLE workflow_ai_usage (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 workflow_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 step_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 model TEXT NOT NULL,
 provider_request_id TEXT NOT NULL DEFAULT '',
 input_tokens BIGINT NOT NULL DEFAULT 0,
 output_tokens BIGINT NOT NULL DEFAULT 0,
 total_tokens BIGINT NOT NULL DEFAULT 0,
 cost_usd DOUBLE PRECISION,
 state TEXT NOT NULL,
 created_at TIMESTAMP NOT NULL
);
CREATE INDEX workflow_ai_usage_workspace ON workflow_ai_usage(workspace_id, created_at);
