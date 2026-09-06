CREATE TABLE IF NOT EXISTS legacy_publication_authoring_backfill_state (
  key TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  cursor_id TEXT NOT NULL DEFAULT '',
  processed_count BIGINT NOT NULL DEFAULT 0,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS posts_legacy_thread_parent_idx
  ON posts (workspace_id, parent_post_id, id);

CREATE INDEX IF NOT EXISTS post_destinations_legacy_authoring_idx
  ON post_destinations (post_id, id);

CREATE INDEX IF NOT EXISTS post_variants_legacy_authoring_idx
  ON post_variants (post_id, social_account_id, id);

CREATE INDEX IF NOT EXISTS jobs_publication_scope_idx
  ON jobs (type, scope_id, status, run_at, id);

CREATE INDEX IF NOT EXISTS jobs_publication_pending_idx
  ON jobs (type, status, id);

CREATE INDEX IF NOT EXISTS provider_write_attempts_legacy_scope_scan_idx
  ON provider_write_attempts (status, id);

CREATE INDEX IF NOT EXISTS provider_write_attempts_publication_target_idx
  ON provider_write_attempts (publication_id, rendition_id, status, operation, id);
