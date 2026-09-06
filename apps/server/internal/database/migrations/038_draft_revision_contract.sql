ALTER TABLE publications
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE posts
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE posts
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp;

CREATE TABLE IF NOT EXISTS draft_revision_changes (
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  changed_domains TEXT NOT NULL DEFAULT '[]',
  changed_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (aggregate_type, aggregate_id, revision)
);

CREATE INDEX IF NOT EXISTS draft_revision_changes_aggregate_idx
  ON draft_revision_changes (aggregate_type, aggregate_id, revision);
