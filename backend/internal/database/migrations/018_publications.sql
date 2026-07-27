CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  title TEXT NOT NULL,
  source_content TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  goal TEXT,
  audience TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  release_plan_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS publications_workspace_status_idx
  ON publications (workspace_id, status);

CREATE INDEX IF NOT EXISTS publications_created_by_idx
  ON publications (created_by);

CREATE TABLE IF NOT EXISTS publication_assets (
  publication_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (publication_id, media_id),
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS publication_assets_media_idx
  ON publication_assets (media_id);

ALTER TABLE posts ADD COLUMN publication_id TEXT;

CREATE INDEX IF NOT EXISTS posts_publication_id_idx
  ON posts (publication_id);
