-- 028: Media analysis and public URL verification metadata.

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

ALTER TABLE media_attachments ADD COLUMN frame_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN analysis_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE media_attachments ADD COLUMN analysis_error TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN public_url_checked_at TIMESTAMP;
ALTER TABLE media_attachments ADD COLUMN public_url_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN public_url_error TEXT NOT NULL DEFAULT '';
