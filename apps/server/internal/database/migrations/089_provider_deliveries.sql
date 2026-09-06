-- 089: Canonical, user-visible provider delivery and reconciliation state.

CREATE UNIQUE INDEX IF NOT EXISTS renditions_delivery_owner_idx
  ON renditions (id, publication_id, social_account_id, target_key);

CREATE TABLE IF NOT EXISTS provider_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL,
  terminal_reason TEXT NOT NULL DEFAULT '',
  current_attempt_id TEXT NOT NULL,
  current_attempt_number INTEGER NOT NULL,
  current_attempt_created_at DATETIME NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  last_reconciled_at DATETIME,
  next_reconciliation_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  updated_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (publication_id, workspace_id)
    REFERENCES publications(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (rendition_id, publication_id, social_account_id, target_key)
    REFERENCES renditions(id, publication_id, social_account_id, target_key) ON DELETE CASCADE,
  FOREIGN KEY (current_attempt_id) REFERENCES provider_write_attempts(id) ON DELETE CASCADE,
  UNIQUE (rendition_id, target_key),
  CHECK (target_key <> ''),
  CHECK (provider <> ''),
  CHECK (current_attempt_number > 0),
  CHECK (state IN (
    'queued', 'submitted', 'processing', 'provider_scheduled',
    'live', 'rejected', 'ambiguous', 'manual_resolution'
  ))
);

CREATE INDEX IF NOT EXISTS provider_deliveries_publication_state_idx
  ON provider_deliveries (publication_id, state, updated_at);

CREATE INDEX IF NOT EXISTS provider_deliveries_reconcile_idx
  ON provider_deliveries (state, next_reconciliation_at);

INSERT INTO provider_deliveries (
  id, workspace_id, publication_id, rendition_id, social_account_id,
  target_key, provider, state, terminal_reason, current_attempt_id,
  current_attempt_number, external_id, external_url,
  current_attempt_created_at, next_reconciliation_at, created_at, updated_at
)
SELECT
  'delivery:' || attempt.rendition_id || ':' || attempt.target_key,
  attempt.workspace_id,
  attempt.publication_id,
  attempt.rendition_id,
  attempt.social_account_id,
  attempt.target_key,
  attempt.provider,
  CASE
    WHEN attempt.status = 'prepared' THEN 'queued'
    WHEN attempt.status = 'accepted' AND attempt.provider_state IN ('scheduled', 'provider_scheduled') THEN 'provider_scheduled'
    WHEN attempt.status = 'accepted' THEN 'live'
    WHEN attempt.status = 'definite_failure' THEN 'rejected'
    WHEN attempt.status = 'ambiguous' AND attempt.provider_reference = '' AND attempt.retry_safety = 'never' THEN 'manual_resolution'
    WHEN attempt.status = 'ambiguous' THEN 'ambiguous'
    WHEN attempt.submission_state = 'pending' AND attempt.provider_state IN ('scheduled', 'provider_scheduled') THEN 'provider_scheduled'
    WHEN attempt.submission_state = 'pending' THEN 'processing'
    ELSE 'submitted'
  END,
  CASE
    WHEN attempt.safe_error_class = '' THEN attempt.safe_error_code
    WHEN attempt.safe_error_code = '' THEN attempt.safe_error_class
    ELSE attempt.safe_error_class || ':' || attempt.safe_error_code
  END,
  attempt.id,
  attempt.attempt_number,
  attempt.external_id,
  attempt.external_url,
  attempt.created_at,
  attempt.reconcile_after,
  attempt.created_at,
  attempt.updated_at
FROM provider_write_attempts AS attempt
WHERE attempt.publication_id IS NOT NULL
  AND attempt.rendition_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM provider_write_attempts AS newer
    WHERE newer.rendition_id = attempt.rendition_id
      AND newer.target_key = attempt.target_key
      AND (
        newer.created_at > attempt.created_at OR
        (newer.created_at = attempt.created_at AND newer.id > attempt.id)
      )
  );
