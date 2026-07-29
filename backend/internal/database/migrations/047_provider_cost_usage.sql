-- 047: Immutable hosted provider-cost events and reconciled monthly counters.

CREATE TABLE IF NOT EXISTS provider_usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  units INTEGER NOT NULL CHECK (units > 0),
  unit_cost_microusd INTEGER NOT NULL CHECK (unit_cost_microusd >= 0),
  cost_microusd INTEGER NOT NULL CHECK (cost_microusd >= 0),
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_usage_events_workspace_period_idx
  ON provider_usage_events (workspace_id, provider, occurred_at);

CREATE INDEX IF NOT EXISTS provider_usage_events_occurred_idx
  ON provider_usage_events (occurred_at, id);

CREATE TABLE IF NOT EXISTS provider_usage_period_counters (
  workspace_id TEXT NOT NULL,
  period_start TIMESTAMP NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  units INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK (cost_microusd >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, period_start, provider, operation),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_usage_period_counters_workspace_period_idx
  ON provider_usage_period_counters (workspace_id, period_start, provider);

CREATE INDEX IF NOT EXISTS provider_usage_period_counters_period_idx
  ON provider_usage_period_counters (period_start, provider);
