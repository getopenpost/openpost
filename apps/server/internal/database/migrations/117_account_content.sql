CREATE TABLE IF NOT EXISTS account_contents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider_content_id TEXT NOT NULL,
  provider_parent_id TEXT NOT NULL DEFAULT '',
  content_profile TEXT NOT NULL DEFAULT 'short_text',
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMP NOT NULL,
  origin TEXT NOT NULL,
  origin_confidence TEXT NOT NULL DEFAULT 'unknown',
  rendition_id TEXT,
  first_discovered_at TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP NOT NULL,
  provider_unavailable_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE SET NULL,
  UNIQUE (social_account_id, provider_content_id),
  CHECK (provider_content_id <> '' AND LENGTH(provider_content_id) <= 500),
  CHECK (LENGTH(provider_parent_id) <= 500),
  CHECK (platform <> '' AND LENGTH(platform) <= 64),
  CHECK (content_profile <> '' AND LENGTH(content_profile) <= 64),
  CHECK (LENGTH(title) <= 500),
  CHECK (LENGTH(text) <= 10000),
  CHECK (external_url = '' OR external_url LIKE 'https://%'),
  CHECK (origin IN ('openpost', 'external')),
  CHECK (origin_confidence IN ('unknown', 'inferred', 'exact'))
);

CREATE INDEX IF NOT EXISTS account_contents_workspace_published_idx
  ON account_contents (workspace_id, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS account_contents_account_published_idx
  ON account_contents (social_account_id, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS account_contents_rendition_idx
  ON account_contents (rendition_id)
  WHERE rendition_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_account_content_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_content_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  metric_metadata_json TEXT NOT NULL DEFAULT '{}',
  capture_key TEXT NOT NULL DEFAULT '',
  captured_at TIMESTAMP NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (account_content_id) REFERENCES account_contents(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_account_content_snapshots_content_captured_idx
  ON analytics_account_content_snapshots (account_content_id, captured_at);

CREATE INDEX IF NOT EXISTS analytics_account_content_snapshots_workspace_captured_idx
  ON analytics_account_content_snapshots (workspace_id, captured_at);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_account_content_snapshots_capture_key_idx
  ON analytics_account_content_snapshots (account_content_id, capture_key)
  WHERE capture_key <> '';

CREATE TABLE IF NOT EXISTS account_content_discovery_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'partial',
  coverage_status TEXT NOT NULL DEFAULT 'partial',
  coverage_description TEXT NOT NULL DEFAULT '',
  cursor TEXT NOT NULL DEFAULT '',
  backfill_watermark TIMESTAMP,
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  failure_code TEXT NOT NULL DEFAULT '',
  failure_message TEXT NOT NULL DEFAULT '',
  next_eligible_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (social_account_id),
  CHECK (status IN ('complete', 'partial', 'permission_required', 'rate_limited', 'cost_limited', 'unsupported', 'failed')),
  CHECK (coverage_status IN ('complete', 'partial', 'permission_required', 'rate_limited', 'cost_limited', 'unsupported', 'failed')),
  CHECK (LENGTH(coverage_description) <= 500),
  CHECK (LENGTH(cursor) <= 2000),
  CHECK (LENGTH(failure_code) <= 64),
  CHECK (LENGTH(failure_message) <= 500)
);

CREATE INDEX IF NOT EXISTS account_content_discovery_states_due_idx
  ON account_content_discovery_states (status, next_eligible_at);

CREATE INDEX IF NOT EXISTS account_content_discovery_states_workspace_idx
  ON account_content_discovery_states (workspace_id);

CREATE TABLE IF NOT EXISTS account_content_observations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  account_content_id TEXT,
  platform TEXT NOT NULL,
  provider_observation_id TEXT NOT NULL,
  provider_content_id TEXT NOT NULL,
  observation_type TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  metric_metadata_json TEXT NOT NULL DEFAULT '{}',
  observed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (account_content_id) REFERENCES account_contents(id) ON DELETE SET NULL,
  UNIQUE (social_account_id, provider_observation_id),
  CHECK (provider_observation_id <> '' AND LENGTH(provider_observation_id) <= 500),
  CHECK (provider_content_id <> '' AND LENGTH(provider_content_id) <= 500),
  CHECK (observation_type <> '' AND LENGTH(observation_type) <= 64)
);

CREATE INDEX IF NOT EXISTS account_content_observations_content_observed_idx
  ON account_content_observations (account_content_id, observed_at);

CREATE INDEX IF NOT EXISTS account_content_observations_account_observed_idx
  ON account_content_observations (social_account_id, observed_at);
