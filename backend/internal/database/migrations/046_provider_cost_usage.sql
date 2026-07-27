CREATE TABLE IF NOT EXISTS provider_usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  units BIGINT NOT NULL,
  unit_cost_microusd BIGINT NOT NULL,
  cost_microusd BIGINT NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_usage_events_workspace_period_idx
  ON provider_usage_events (workspace_id, occurred_at);

CREATE INDEX IF NOT EXISTS provider_usage_events_provider_period_idx
  ON provider_usage_events (provider, occurred_at);

CREATE TABLE IF NOT EXISTS provider_usage_period_counters (
  workspace_id TEXT NOT NULL,
  period_start TIMESTAMP NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  event_count BIGINT NOT NULL DEFAULT 0,
  units BIGINT NOT NULL DEFAULT 0,
  cost_microusd BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, period_start, provider, operation),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_usage_period_counters_period_idx
  ON provider_usage_period_counters (period_start, provider);
