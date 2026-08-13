-- 036: Media provenance, Studio lineage, collections, tags, and workspace-scoped deduplication.

ALTER TABLE media_attachments ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE media_attachments ADD COLUMN asset_kind TEXT NOT NULL DEFAULT 'library';
ALTER TABLE media_attachments ADD COLUMN parent_media_id TEXT;
ALTER TABLE media_attachments ADD COLUMN design_document_id TEXT;
ALTER TABLE media_attachments ADD COLUMN design_page_id TEXT;

CREATE INDEX IF NOT EXISTS media_workspace_source_created_idx
  ON media_attachments (workspace_id, source, created_at);

CREATE INDEX IF NOT EXISTS media_parent_idx
  ON media_attachments (parent_media_id);

CREATE INDEX IF NOT EXISTS media_design_idx
  ON media_attachments (design_document_id, design_page_id);

CREATE UNIQUE INDEX IF NOT EXISTS media_workspace_hash_idx
  ON media_attachments (workspace_id, file_hash)
  WHERE source = 'upload' AND asset_kind = 'library';

CREATE TABLE IF NOT EXISTS media_collections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS media_collections_workspace_name_idx
  ON media_collections (workspace_id, name);

CREATE TABLE IF NOT EXISTS media_collection_items (
  collection_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (collection_id, media_id),
  FOREIGN KEY (collection_id) REFERENCES media_collections(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS media_collection_items_media_idx
  ON media_collection_items (media_id);

CREATE TABLE IF NOT EXISTS media_tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS media_tags_workspace_name_idx
  ON media_tags (workspace_id, normalized_name);

CREATE TABLE IF NOT EXISTS media_tag_assignments (
  tag_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (tag_id, media_id),
  FOREIGN KEY (tag_id) REFERENCES media_tags(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS media_tag_assignments_media_idx
  ON media_tag_assignments (media_id);
