ALTER TABLE billing_subscriptions
  ADD COLUMN provider_updated_at TIMESTAMP;

ALTER TABLE billing_subscriptions
  ADD COLUMN past_due_since TIMESTAMP;

ALTER TABLE billing_webhook_events
  ADD COLUMN occurred_at TIMESTAMP;
