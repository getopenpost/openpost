-- 046: Durable video analysis metadata.

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
