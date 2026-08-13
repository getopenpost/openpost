ALTER TABLE billing_checkout_attempts
  ADD COLUMN confirmation_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX billing_checkout_attempts_confirmation_idx
  ON billing_checkout_attempts (user_id, confirmation_key)
  WHERE user_id IS NOT NULL AND user_id != '' AND confirmation_key != '';
