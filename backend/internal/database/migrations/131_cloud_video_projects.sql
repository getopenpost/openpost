CREATE TABLE IF NOT EXISTS video_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  head_revision BIGINT NOT NULL DEFAULT 1,
  document_json TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  attention_reason TEXT NOT NULL DEFAULT '',
  preview_object_key TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  trashed_at TIMESTAMP,
  retention_expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS video_projects_workspace_updated_idx
  ON video_projects (workspace_id, trashed_at, updated_at);

CREATE TABLE IF NOT EXISTS video_project_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  parent_revision BIGINT NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  document_json TEXT NOT NULL,
  touched_targets_json TEXT NOT NULL DEFAULT '[]',
  author_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  mutation_id TEXT NOT NULL DEFAULT '',
  restored_from_revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  expires_at TIMESTAMP,
  UNIQUE (project_id, revision),
  FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS video_project_revisions_retention_idx
  ON video_project_revisions (project_id, expires_at);

CREATE TABLE IF NOT EXISTS video_project_mutations (
  project_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  conflict_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (project_id, mutation_id),
  FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_project_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_revision BIGINT NOT NULL,
  head_revision BIGINT NOT NULL,
  mutation_id TEXT NOT NULL,
  document_json TEXT NOT NULL,
  overlap_targets_json TEXT NOT NULL DEFAULT '[]',
  author_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  resolved_at TIMESTAMP,
  UNIQUE (project_id, mutation_id),
  FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS video_project_checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  revision BIGINT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  deleted_at TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS video_project_checkpoints_project_idx
  ON video_project_checkpoints (project_id, deleted_at, created_at);

CREATE TABLE IF NOT EXISTS project_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  media_id TEXT,
  stable_media_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  attention_reason TEXT NOT NULL DEFAULT '',
  preparation_json TEXT NOT NULL DEFAULT '{}',
  required BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  UNIQUE (project_id, stable_media_id),
  FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS project_assets_project_status_idx
  ON project_assets (project_id, required, status);
CREATE INDEX IF NOT EXISTS project_assets_workspace_sha_idx
  ON project_assets (workspace_id, sha256);
