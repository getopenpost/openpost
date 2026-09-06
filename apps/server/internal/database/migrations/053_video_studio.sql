-- 053: Video Studio cloud projects, revisions, composer handoff, and stock provenance.
-- The media_attachments.video_project_id column is added idempotently by the
-- migration runner because fresh Bun bootstrap schemas already include it.

CREATE TABLE IF NOT EXISTS video_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  title TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  document_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  cover_preview_media_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  deleted_at TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (cover_preview_media_id) REFERENCES media_attachments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS video_projects_workspace_updated_idx
  ON video_projects (workspace_id, updated_at);

CREATE INDEX IF NOT EXISTS video_projects_workspace_deleted_idx
  ON video_projects (workspace_id, deleted_at);

CREATE INDEX IF NOT EXISTS video_projects_creator_idx
  ON video_projects (created_by_id);

CREATE TABLE IF NOT EXISTS video_project_assets (
  video_project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT 'source',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (video_project_id, source_id),
  FOREIGN KEY (video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS video_project_assets_media_idx
  ON video_project_assets (media_id);

CREATE TABLE IF NOT EXISTS video_project_revisions (
  id TEXT PRIMARY KEY,
  video_project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  snapshot BLOB NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  expires_at TIMESTAMP,
  FOREIGN KEY (video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS video_project_revisions_project_revision_idx
  ON video_project_revisions (video_project_id, revision);

CREATE INDEX IF NOT EXISTS video_project_revisions_retention_idx
  ON video_project_revisions (kind, expires_at);

CREATE TABLE IF NOT EXISTS video_return_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  return_url TEXT NOT NULL,
  purpose TEXT NOT NULL,
  constraints_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{"project_id":"","exports":[]}',
  project_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  expires_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  consumed_at TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS video_return_tokens_expiry_idx
  ON video_return_tokens (expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS media_provenance (
  media_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  creator_name TEXT NOT NULL DEFAULT '',
  creator_url TEXT NOT NULL DEFAULT '',
  license_name TEXT NOT NULL DEFAULT '',
  license_url TEXT NOT NULL DEFAULT '',
  attribution_text TEXT NOT NULL DEFAULT '',
  imported_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS media_provenance_provider_external_idx
  ON media_provenance (provider, external_id);

CREATE TABLE IF NOT EXISTS stock_search_cache (
  provider TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  normalized_response_json TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (provider, media_kind, query_hash)
);

CREATE INDEX IF NOT EXISTS stock_search_cache_expiry_idx
  ON stock_search_cache (expires_at);
