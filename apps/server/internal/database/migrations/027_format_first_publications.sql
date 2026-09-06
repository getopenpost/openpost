-- 027: Format-first publication/rendition schema.
--
-- This is a breaking authoring-model migration. New product surfaces write
-- publications and renditions directly instead of encoding thread drafts in
-- posts.content or storing destination variants in post_variants.

ALTER TABLE publications ADD COLUMN content_profile TEXT NOT NULL DEFAULT 'short_text';
ALTER TABLE publications ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN scheduled_at TIMESTAMP;
ALTER TABLE publications ADD COLUMN actual_run_at TIMESTAMP;
ALTER TABLE publications ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS publications_profile_status_idx
  ON publications (workspace_id, content_profile, status);

CREATE TABLE IF NOT EXISTS renditions (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  profile TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  external_id TEXT,
  external_url TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS renditions_publication_account_idx
  ON renditions (publication_id, social_account_id);

CREATE INDEX IF NOT EXISTS renditions_publication_status_idx
  ON renditions (publication_id, status);

CREATE INDEX IF NOT EXISTS renditions_account_status_idx
  ON renditions (social_account_id, status);

CREATE TABLE IF NOT EXISTS rendition_media (
  rendition_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'attachment',
  display_order INTEGER NOT NULL DEFAULT 0,
  alt_text TEXT,
  thumbnail_timestamp_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rendition_id, media_id),
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS rendition_media_media_idx
  ON rendition_media (media_id);

CREATE TABLE IF NOT EXISTS media_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  storage_type TEXT DEFAULT 'local',
  mime_type TEXT,
  processing_status TEXT DEFAULT 'ready',
  size INTEGER,
  original_filename TEXT,
  width INTEGER,
  height INTEGER,
  thumbnails TEXT,
  file_hash TEXT UNIQUE,
  alt_text TEXT,
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

ALTER TABLE media_attachments ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN frame_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN dominant_type TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN analysis_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE media_attachments ADD COLUMN analysis_error TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN thumbnail_object_key TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN public_url_ready BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE media_attachments ADD COLUMN public_url_checked_at TIMESTAMP;
ALTER TABLE media_attachments ADD COLUMN public_url_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN public_url_error TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS provider_media_states (
  post_id TEXT NOT NULL DEFAULT '',
  social_account_id TEXT NOT NULL DEFAULT '',
  media_id TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  platform_media_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (post_id, social_account_id, media_id)
);

ALTER TABLE provider_media_states ADD COLUMN rendition_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS provider_media_states_rendition_idx
  ON provider_media_states (rendition_id, media_id, platform);
