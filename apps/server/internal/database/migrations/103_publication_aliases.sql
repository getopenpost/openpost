CREATE TABLE IF NOT EXISTS publication_aliases (
  alias_type TEXT NOT NULL,
  alias_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  segment_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (alias_type, alias_id)
);

CREATE INDEX IF NOT EXISTS publication_aliases_publication_idx
  ON publication_aliases (publication_id, segment_id);
