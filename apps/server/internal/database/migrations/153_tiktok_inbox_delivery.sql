-- Preserve provider receipts while adding user-completed inbox delivery.
CREATE TABLE provider_deliveries_with_inbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL,
  retry_safety TEXT NOT NULL DEFAULT 'never',
  safe_error_class TEXT NOT NULL DEFAULT '',
  safe_error_code TEXT NOT NULL DEFAULT '',
  error_http_status INTEGER NOT NULL DEFAULT 0,
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
    'live', 'rejected', 'ambiguous', 'manual_resolution', 'awaiting_user'
  ))
);

INSERT INTO provider_deliveries_with_inbox (id,workspace_id,publication_id,rendition_id,social_account_id,target_key,provider,state,terminal_reason,current_attempt_id,current_attempt_number,current_attempt_created_at,external_id,external_url,last_reconciled_at,next_reconciliation_at,created_at,updated_at,retry_safety,safe_error_class,safe_error_code,error_http_status) SELECT id,workspace_id,publication_id,rendition_id,social_account_id,target_key,provider,state,terminal_reason,current_attempt_id,current_attempt_number,current_attempt_created_at,external_id,external_url,last_reconciled_at,next_reconciliation_at,created_at,updated_at,retry_safety,safe_error_class,safe_error_code,error_http_status FROM provider_deliveries;
DROP TABLE provider_deliveries;
ALTER TABLE provider_deliveries_with_inbox RENAME TO provider_deliveries;
CREATE INDEX IF NOT EXISTS provider_deliveries_publication_state_idx
  ON provider_deliveries (publication_id, state, updated_at);

CREATE INDEX IF NOT EXISTS provider_deliveries_reconcile_idx
  ON provider_deliveries (state, next_reconciliation_at);
