ALTER TABLE billing_checkout_attempts
  RENAME COLUMN checkout_configuration_id TO checkout_attempt_id;

ALTER TABLE billing_checkout_attempts
  RENAME COLUMN provider_plan_id TO provider_price_id;

ALTER TABLE billing_checkout_attempts
  RENAME COLUMN provider_membership_id TO provider_subscription_id;

DROP INDEX IF EXISTS billing_checkout_attempts_membership_idx;

CREATE UNIQUE INDEX billing_checkout_attempts_subscription_idx
  ON billing_checkout_attempts (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL AND provider_subscription_id != '';

ALTER TABLE billing_subscriptions
  DROP COLUMN provider_manage_url;
