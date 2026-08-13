DROP TABLE IF EXISTS billing_checkout_attempts;
DROP TABLE IF EXISTS billing_webhook_events;
DROP TABLE IF EXISTS billing_subscriptions;

CREATE TABLE billing_subscriptions (
  organization_id TEXT PRIMARY KEY,
  workspace_id TEXT,
  provider TEXT NOT NULL DEFAULT 'whop',
  provider_customer_id TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL UNIQUE,
  provider_product_id TEXT,
  provider_price_id TEXT,
  provider_manage_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  entitlement_snapshot TEXT NOT NULL DEFAULT '{}',
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  raw_payload TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE INDEX billing_subscriptions_provider_customer_idx
  ON billing_subscriptions (provider, provider_customer_id);

CREATE INDEX billing_subscriptions_status_idx
  ON billing_subscriptions (status);

CREATE INDEX billing_subscriptions_workspace_idx
  ON billing_subscriptions (workspace_id);

CREATE TABLE billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'whop',
  event_type TEXT NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX billing_webhook_events_provider_type_idx
  ON billing_webhook_events (provider, event_type);

CREATE TABLE billing_checkout_attempts (
  checkout_configuration_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT,
  user_id TEXT,
  provider TEXT NOT NULL DEFAULT 'whop',
  provider_plan_id TEXT NOT NULL,
  provider_membership_id TEXT,
  plan_id TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX billing_checkout_attempts_organization_idx
  ON billing_checkout_attempts (organization_id, created_at);

CREATE UNIQUE INDEX billing_checkout_attempts_membership_idx
  ON billing_checkout_attempts (provider_membership_id)
  WHERE provider_membership_id IS NOT NULL AND provider_membership_id != '';
