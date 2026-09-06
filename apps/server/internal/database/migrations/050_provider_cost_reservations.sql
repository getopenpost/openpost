-- 050: Separate confirmed provider cost from in-flight or ambiguous exposure.

CREATE TABLE IF NOT EXISTS provider_usage_reservations (
  operation_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'unknown')),
  units INTEGER NOT NULL CHECK (units > 0),
  unit_cost_microusd INTEGER NOT NULL CHECK (unit_cost_microusd >= 0),
  cost_microusd INTEGER NOT NULL CHECK (cost_microusd >= 0),
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_usage_reservations_workspace_period_idx
  ON provider_usage_reservations (workspace_id, provider, occurred_at);

ALTER TABLE provider_usage_period_counters
  ADD COLUMN reserved_event_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_event_count >= 0);

ALTER TABLE provider_usage_period_counters
  ADD COLUMN reserved_units INTEGER NOT NULL DEFAULT 0 CHECK (reserved_units >= 0);

ALTER TABLE provider_usage_period_counters
  ADD COLUMN reserved_cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cost_microusd >= 0);
