CREATE TABLE IF NOT EXISTS billing_customers (
  provider TEXT NOT NULL,
  provider_customer_id TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  raw_payload TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (provider, provider_customer_id)
);

CREATE INDEX IF NOT EXISTS billing_customers_email_idx
  ON billing_customers (email);
