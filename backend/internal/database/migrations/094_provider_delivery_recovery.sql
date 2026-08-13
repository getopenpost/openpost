-- 094: Keep safe recovery evidence on the canonical provider delivery projection.

ALTER TABLE provider_deliveries ADD COLUMN retry_safety TEXT NOT NULL DEFAULT 'never';
ALTER TABLE provider_deliveries ADD COLUMN safe_error_class TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_deliveries ADD COLUMN safe_error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_deliveries ADD COLUMN error_http_status INTEGER NOT NULL DEFAULT 0;

UPDATE provider_deliveries
SET
  retry_safety = COALESCE((
    SELECT attempt.retry_safety FROM provider_write_attempts AS attempt
    WHERE attempt.id = provider_deliveries.current_attempt_id
  ), 'never'),
  safe_error_class = COALESCE((
    SELECT attempt.safe_error_class FROM provider_write_attempts AS attempt
    WHERE attempt.id = provider_deliveries.current_attempt_id
  ), ''),
  safe_error_code = COALESCE((
    SELECT attempt.safe_error_code FROM provider_write_attempts AS attempt
    WHERE attempt.id = provider_deliveries.current_attempt_id
  ), ''),
  error_http_status = COALESCE((
    SELECT attempt.error_http_status FROM provider_write_attempts AS attempt
    WHERE attempt.id = provider_deliveries.current_attempt_id
  ), 0);
