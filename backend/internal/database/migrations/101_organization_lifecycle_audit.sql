CREATE TABLE IF NOT EXISTS organization_lifecycle_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  workspace_count INTEGER NOT NULL,
  billing_state TEXT NOT NULL DEFAULT 'none',
  actor_user_id TEXT,
  action TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS organization_lifecycle_audit_events_org_idx
  ON organization_lifecycle_audit_events (organization_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_checkout_cancellations (
  checkout_attempt_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'paddle',
  provider_subscription_id TEXT NOT NULL DEFAULT '',
  canceled_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS billing_checkout_cancellations_org_idx
  ON billing_checkout_cancellations (organization_id, canceled_at DESC);
