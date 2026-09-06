CREATE TABLE IF NOT EXISTS usage_counters (
  workspace_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  period_start TIMESTAMP NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (workspace_id, metric, period_start),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS usage_counters_workspace_period_idx
  ON usage_counters (workspace_id, period_start);

CREATE INDEX IF NOT EXISTS usage_counters_metric_period_idx
  ON usage_counters (metric, period_start);
