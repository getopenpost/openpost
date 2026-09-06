-- 037: Studio workspace templates and brand kits.

CREATE TABLE IF NOT EXISTS design_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  preset_key TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT NOT NULL,
  preview_media_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (preview_media_id) REFERENCES media_attachments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS design_templates_workspace_updated_idx
  ON design_templates (workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS design_template_media_references (
  design_template_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (design_template_id, media_id),
  FOREIGN KEY (design_template_id) REFERENCES design_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS design_template_media_references_media_idx
  ON design_template_media_references (media_id);

CREATE TABLE IF NOT EXISTS brand_kits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Workspace brand',
  revision INTEGER NOT NULL DEFAULT 1,
  colors_json TEXT NOT NULL DEFAULT '[]',
  text_styles_json TEXT NOT NULL DEFAULT '{}',
  backgrounds_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS brand_assets (
  id TEXT PRIMARY KEY,
  brand_kit_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (brand_kit_id) REFERENCES brand_kits(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS brand_assets_kit_media_role_idx
  ON brand_assets (brand_kit_id, media_id, role);

CREATE INDEX IF NOT EXISTS brand_assets_media_idx
  ON brand_assets (media_id);

CREATE TABLE IF NOT EXISTS brand_fonts (
  id TEXT PRIMARY KEY,
  brand_kit_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  family TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 400,
  style TEXT NOT NULL DEFAULT 'normal',
  license_acknowledged_by TEXT NOT NULL,
  license_acknowledged_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (brand_kit_id) REFERENCES brand_kits(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT,
  FOREIGN KEY (license_acknowledged_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS brand_fonts_kit_family_weight_style_idx
  ON brand_fonts (brand_kit_id, family, weight, style);

CREATE INDEX IF NOT EXISTS brand_fonts_media_idx
  ON brand_fonts (media_id);
