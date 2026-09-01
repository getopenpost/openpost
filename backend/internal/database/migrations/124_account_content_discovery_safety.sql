ALTER TABLE account_content_discovery_states
  ADD COLUMN cycle_started_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS account_content_discovery_leases (
  provider TEXT NOT NULL,
  slot INTEGER NOT NULL,
  owner_job_id TEXT NOT NULL,
  lease_expires_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (provider, slot),
  CHECK (provider <> '' AND LENGTH(provider) <= 64),
  CHECK (slot >= 0),
  CHECK (owner_job_id <> '' AND LENGTH(owner_job_id) <= 200)
);

CREATE INDEX IF NOT EXISTS account_content_discovery_leases_expiry_idx
  ON account_content_discovery_leases (lease_expires_at);
