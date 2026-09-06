-- 035: OpenPost Studio editable documents, pages, recovery revisions, and media references.

CREATE TABLE IF NOT EXISTS design_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  title TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  preset_key TEXT NOT NULL DEFAULT '',
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  brand_kit_id TEXT,
  brand_kit_revision INTEGER NOT NULL DEFAULT 0,
  cover_preview_media_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  deleted_at TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (cover_preview_media_id) REFERENCES media_attachments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS design_documents_workspace_updated_idx
  ON design_documents (workspace_id, deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS design_pages (
  id TEXT PRIMARY KEY,
  design_document_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  background_color TEXT NOT NULL DEFAULT '#ffffff',
  scene_json TEXT NOT NULL DEFAULT '[]',
  preview_media_id TEXT,
  latest_export_media_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (design_document_id) REFERENCES design_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (preview_media_id) REFERENCES media_attachments(id) ON DELETE SET NULL,
  FOREIGN KEY (latest_export_media_id) REFERENCES media_attachments(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS design_pages_document_order_idx
  ON design_pages (design_document_id, display_order);

CREATE TABLE IF NOT EXISTS design_revisions (
  id TEXT PRIMARY KEY,
  design_document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  snapshot BLOB NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  expires_at TIMESTAMP,
  FOREIGN KEY (design_document_id) REFERENCES design_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS design_revisions_document_revision_idx
  ON design_revisions (design_document_id, revision);

CREATE INDEX IF NOT EXISTS design_revisions_retention_idx
  ON design_revisions (kind, expires_at);

CREATE TABLE IF NOT EXISTS design_media_references (
  design_document_id TEXT NOT NULL,
  design_page_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT 'layer',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (design_document_id, design_page_id, media_id),
  FOREIGN KEY (design_document_id) REFERENCES design_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (design_page_id) REFERENCES design_pages(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS design_media_references_media_idx
  ON design_media_references (media_id);

CREATE TABLE IF NOT EXISTS design_return_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  return_url TEXT NOT NULL,
  purpose TEXT NOT NULL,
  max_selection INTEGER NOT NULL DEFAULT 1,
  constraints_json TEXT NOT NULL DEFAULT '{}',
  result_media_ids TEXT NOT NULL DEFAULT '[]',
  design_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  expires_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  consumed_at TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS design_return_tokens_expiry_idx
  ON design_return_tokens (expires_at, consumed_at);
