ALTER TABLE publication_segment_media ADD COLUMN role TEXT NOT NULL DEFAULT 'attachment';
ALTER TABLE publication_segment_media ADD COLUMN alt_text TEXT NOT NULL DEFAULT '';
ALTER TABLE publication_segment_media ADD COLUMN thumbnail_timestamp_ms INTEGER NOT NULL DEFAULT 0;
