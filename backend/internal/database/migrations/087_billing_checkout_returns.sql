ALTER TABLE billing_checkout_attempts
  ADD COLUMN return_path TEXT NOT NULL DEFAULT '';

ALTER TABLE billing_checkout_attempts
  ADD COLUMN return_consumed_at TIMESTAMP;

CREATE INDEX billing_checkout_attempts_return_idx
  ON billing_checkout_attempts (user_id, checkout_attempt_id, status);
