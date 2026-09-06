-- Some migration fixtures and early installations reached this version
-- without the transitional table. Materialize an empty compatible source so
-- the same copy-and-retire statements remain safe in every upgrade shape.
CREATE TABLE IF NOT EXISTS communication_sync_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  cursor TEXT NOT NULL DEFAULT '',
  backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  next_sync_at TIMESTAMP,
  empty_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS engagement_sync_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  cursor TEXT NOT NULL DEFAULT '',
  backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  next_sync_at TIMESTAMP,
  empty_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (rendition_id)
);

CREATE INDEX IF NOT EXISTS engagement_sync_states_due_idx
  ON engagement_sync_states (status, next_sync_at);

CREATE TABLE IF NOT EXISTS messaging_sync_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  cursor TEXT NOT NULL DEFAULT '',
  backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
  last_attempted_at TIMESTAMP,
  last_success_at TIMESTAMP,
  next_sync_at TIMESTAMP,
  empty_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  UNIQUE (social_account_id)
);

CREATE INDEX IF NOT EXISTS messaging_sync_states_due_idx
  ON messaging_sync_states (status, next_sync_at);

INSERT INTO engagement_sync_states (
  id, workspace_id, rendition_id, social_account_id, platform, status,
  error_code, error_message, cursor, backfill_complete, last_attempted_at,
  last_success_at, next_sync_at, empty_streak, created_at, updated_at
)
SELECT id, workspace_id, subject_id, social_account_id, platform, status,
  error_code, error_message, cursor, backfill_complete, last_attempted_at,
  last_success_at, next_sync_at, empty_streak, created_at, updated_at
FROM communication_sync_states
WHERE capability = 'engagement' AND subject_type = 'rendition'
ON CONFLICT (id) DO NOTHING;

INSERT INTO messaging_sync_states (
  id, workspace_id, social_account_id, platform, status, error_code,
  error_message, cursor, backfill_complete, last_attempted_at, last_success_at,
  next_sync_at, empty_streak, created_at, updated_at
)
SELECT id, workspace_id, social_account_id, platform, status, error_code,
  error_message, cursor, backfill_complete, last_attempted_at, last_success_at,
  next_sync_at, empty_streak, created_at, updated_at
FROM communication_sync_states
WHERE capability = 'messages' AND subject_type = 'account'
ON CONFLICT (id) DO NOTHING;

DROP INDEX IF EXISTS communication_sync_states_due_idx;
DROP TABLE communication_sync_states;

UPDATE jobs
SET status = 'completed', locked_at = NULL, locked_by = '',
    last_error = 'Superseded by independent engagement and messaging sweeps.'
WHERE type = 'communications_sweep' AND status IN ('pending', 'processing');

DROP INDEX IF EXISTS communications_sweep_pending_unique_idx;
DROP INDEX IF EXISTS communications_subject_active_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS engagement_subject_active_unique_idx
  ON jobs (type, payload)
  WHERE status IN ('pending', 'processing') AND type IN ('engagement_sync', 'engagement_action');

CREATE UNIQUE INDEX IF NOT EXISTS messaging_subject_active_unique_idx
  ON jobs (type, payload)
  WHERE status IN ('pending', 'processing') AND type IN ('messages_sync', 'message_send');
