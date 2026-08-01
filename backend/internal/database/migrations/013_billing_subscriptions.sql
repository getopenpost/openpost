CREATE TABLE IF NOT EXISTS billing_subscriptions (
  workspace_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'polar',
  provider_customer_id TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL UNIQUE,
  provider_product_id TEXT,
  provider_price_id TEXT,
  status TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  entitlement_snapshot TEXT NOT NULL DEFAULT '{}',
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  raw_payload TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_provider_customer_idx
  ON billing_subscriptions (provider, provider_customer_id);

CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx
  ON billing_subscriptions (status);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'polar',
  event_type TEXT NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS billing_webhook_events_provider_type_idx
  ON billing_webhook_events (provider, event_type);
