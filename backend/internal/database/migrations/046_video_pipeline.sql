-- 046: Durable video analysis metadata and immutable rendered derivatives.

ALTER TABLE media_attachments ADD COLUMN container_format TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN video_codec TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN video_profile TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN audio_codec TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN pixel_format TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN color_space TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN bit_rate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN audio_channels INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN processing_progress INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS video_derivatives (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_media_id TEXT NOT NULL,
  output_media_id TEXT,
  provider TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL DEFAULT '',
  preset TEXT NOT NULL DEFAULT 'source',
  recipe_json TEXT NOT NULL DEFAULT '{}',
  recipe_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (source_media_id) REFERENCES media_attachments(id) ON DELETE CASCADE,
  FOREIGN KEY (output_media_id) REFERENCES media_attachments(id) ON DELETE SET NULL,
  UNIQUE (source_media_id, provider, profile, preset, recipe_hash)
);

CREATE INDEX IF NOT EXISTS video_derivatives_workspace_status_idx
  ON video_derivatives (workspace_id, status, updated_at);

CREATE INDEX IF NOT EXISTS video_derivatives_source_idx
  ON video_derivatives (source_media_id, provider, profile);
