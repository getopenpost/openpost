CREATE TABLE IF NOT EXISTS organization_theme_settings (
  organization_id TEXT PRIMARY KEY,
  default_reference_kind TEXT NOT NULL DEFAULT 'built_in',
  default_reference_id TEXT NOT NULL DEFAULT 'workshop',
  default_reference_version INTEGER NOT NULL DEFAULT 1,
  assignments_locked BOOLEAN NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CHECK (default_reference_kind IN ('built_in', 'custom')),
  CHECK (default_reference_id <> '' AND default_reference_version >= 1)
);

CREATE TABLE IF NOT EXISTS organization_themes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  latest_published_revision INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE (organization_id, normalized_name),
  UNIQUE (id, organization_id),
  CHECK (id <> '' AND organization_id <> '' AND name <> ''),
  CHECK (latest_published_revision >= 0)
);

CREATE INDEX IF NOT EXISTS organization_themes_org_updated_idx
  ON organization_themes (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS organization_theme_drafts (
  theme_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (theme_id, organization_id) REFERENCES organization_themes(id, organization_id) ON DELETE CASCADE,
  CHECK (revision >= 1 AND name <> '' AND manifest_json <> '')
);

CREATE TABLE IF NOT EXISTS organization_theme_revisions (
  theme_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_revision INTEGER,
  PRIMARY KEY (theme_id, revision),
  FOREIGN KEY (theme_id, organization_id) REFERENCES organization_themes(id, organization_id) ON DELETE CASCADE,
  CHECK (revision >= 1 AND name <> '' AND manifest_json <> ''),
  CHECK (source_revision IS NULL OR source_revision >= 1)
);

CREATE INDEX IF NOT EXISTS organization_theme_revisions_org_idx
  ON organization_theme_revisions (organization_id, theme_id, revision DESC);

CREATE TABLE IF NOT EXISTS workspace_theme_assignments (
  workspace_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  reference_kind TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  reference_version INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CHECK (reference_kind IN ('built_in', 'custom')),
  CHECK (reference_id <> '' AND reference_version >= 1)
);

CREATE INDEX IF NOT EXISTS workspace_theme_assignments_org_ref_idx
  ON workspace_theme_assignments (organization_id, reference_kind, reference_id, reference_version);

CREATE TABLE IF NOT EXISTS organization_theme_assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT NOT NULL,
  native_object_key TEXT NOT NULL DEFAULT '',
  native_media_type TEXT NOT NULL DEFAULT '',
  native_size_bytes INTEGER NOT NULL DEFAULT 0,
  native_checksum_sha256 TEXT NOT NULL DEFAULT '',
  font_family TEXT NOT NULL DEFAULT '',
  font_style TEXT NOT NULL DEFAULT '',
  font_weight INTEGER NOT NULL DEFAULT 0,
  license_acknowledged BOOLEAN NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CHECK (kind IN ('font', 'background', 'texture', 'illustration')),
  CHECK (name <> '' AND media_type <> '' AND object_key <> ''),
  CHECK (size_bytes > 0),
  CHECK (width BETWEEN 0 AND 8192 AND height BETWEEN 0 AND 8192),
  CHECK ((kind = 'font' AND width = 0 AND height = 0) OR (kind <> 'font' AND width > 0 AND height > 0)),
  CHECK ((kind = 'font' AND media_type = 'font/woff2' AND license_acknowledged = TRUE AND font_family <> '' AND font_weight BETWEEN 100 AND 900 AND native_object_key <> '' AND native_media_type IN ('font/ttf', 'font/otf') AND native_size_bytes > 0 AND native_checksum_sha256 <> '') OR kind <> 'font'),
  CHECK ((kind <> 'font' AND native_object_key = '' AND native_media_type = '' AND native_size_bytes = 0 AND native_checksum_sha256 = '') OR kind = 'font')
);

CREATE INDEX IF NOT EXISTS organization_theme_assets_org_idx
  ON organization_theme_assets (organization_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS organization_theme_assets_native_key_idx
  ON organization_theme_assets (native_object_key)
  WHERE native_object_key <> '';

CREATE TABLE IF NOT EXISTS organization_theme_draft_assets (
  theme_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (theme_id, asset_id),
  FOREIGN KEY (theme_id) REFERENCES organization_theme_drafts(theme_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES organization_theme_assets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS organization_theme_draft_assets_asset_idx
  ON organization_theme_draft_assets (asset_id);

CREATE TABLE IF NOT EXISTS organization_theme_revision_assets (
  theme_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (theme_id, revision, asset_id),
  FOREIGN KEY (theme_id, revision) REFERENCES organization_theme_revisions(theme_id, revision) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES organization_theme_assets(id) ON DELETE RESTRICT
);
