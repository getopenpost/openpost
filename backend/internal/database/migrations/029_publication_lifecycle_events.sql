CREATE TABLE IF NOT EXISTS publication_lifecycle_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  rendition_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS publication_lifecycle_events_publication_idx
  ON publication_lifecycle_events (publication_id, created_at DESC);

CREATE INDEX IF NOT EXISTS publication_lifecycle_events_workspace_idx
  ON publication_lifecycle_events (workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS publication_lifecycle_events_idempotency_idx
  ON publication_lifecycle_events (idempotency_key)
  WHERE idempotency_key <> '';
