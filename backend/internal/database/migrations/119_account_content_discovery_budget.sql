ALTER TABLE account_content_discovery_states
  ADD COLUMN cycle_published_after TIMESTAMP;
ALTER TABLE account_content_discovery_states
  ADD COLUMN initial_completed_at TIMESTAMP;
ALTER TABLE account_content_discovery_states
  ADD COLUMN initial_items_discovered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_content_discovery_states
  ADD COLUMN read_budget_window_start TIMESTAMP;
ALTER TABLE account_content_discovery_states
  ADD COLUMN read_budget_used INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS account_content_discovery_states_budget_idx
  ON account_content_discovery_states (platform, read_budget_window_start);
