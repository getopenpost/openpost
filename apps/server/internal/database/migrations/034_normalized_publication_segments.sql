-- 034: Separate publishing intent, canonical segments, and provider output.
--
-- Flat publication and rendition fields remain compatibility mirrors for one
-- release. Existing rows are backfilled into one ordered segment.

ALTER TABLE publications ADD COLUMN intent TEXT NOT NULL DEFAULT 'post';
ALTER TABLE renditions ADD COLUMN output_profile TEXT NOT NULL DEFAULT '';

UPDATE publications
SET intent = CASE content_profile
  WHEN 'thread' THEN 'thread'
  WHEN 'story' THEN 'story'
  WHEN 'short_video' THEN 'short_video'
  WHEN 'long_video' THEN 'video'
  ELSE 'post'
END
WHERE intent = '' OR intent = 'post';

UPDATE renditions
SET output_profile = platform || '.' ||
  CASE
    WHEN profile = 'thread' THEN 'thread'
    WHEN profile = 'story' THEN 'story'
    WHEN profile = 'short_video' AND platform = 'youtube' THEN 'short'
    WHEN profile = 'long_video' THEN 'video'
    WHEN profile = 'short_video' AND platform IN ('instagram', 'facebook') THEN 'reel'
    WHEN profile = 'short_video' THEN 'video'
    WHEN profile = 'carousel' AND platform = 'linkedin' THEN 'document'
    WHEN profile = 'carousel' AND platform = 'tiktok' THEN 'photo'
    WHEN profile = 'carousel' THEN 'carousel'
    ELSE 'post'
  END
WHERE output_profile = '';

CREATE TABLE IF NOT EXISTS publication_segments (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS publication_segments_position_idx
  ON publication_segments (publication_id, position);

CREATE TABLE IF NOT EXISTS publication_segment_media (
  segment_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (segment_id, media_id),
  FOREIGN KEY (segment_id) REFERENCES publication_segments(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS publication_segment_media_media_idx
  ON publication_segment_media (media_id);

CREATE TABLE IF NOT EXISTS rendition_segments (
  id TEXT PRIMARY KEY,
  rendition_id TEXT NOT NULL,
  publication_segment_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  external_id TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (rendition_id) REFERENCES renditions(id) ON DELETE CASCADE,
  FOREIGN KEY (publication_segment_id) REFERENCES publication_segments(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS rendition_segments_position_idx
  ON rendition_segments (rendition_id, position);

CREATE TABLE IF NOT EXISTS rendition_segment_media (
  rendition_segment_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'attachment',
  display_order INTEGER NOT NULL DEFAULT 0,
  alt_text TEXT NOT NULL DEFAULT '',
  thumbnail_timestamp_ms INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (rendition_segment_id, media_id),
  FOREIGN KEY (rendition_segment_id) REFERENCES rendition_segments(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS rendition_segment_media_media_idx
  ON rendition_segment_media (media_id);

INSERT INTO publication_segments (
  id, publication_id, position, body, title, description, url,
  settings_json, created_at, updated_at
)
SELECT
  'legacy:' || p.id, p.id, 0, p.source_text, p.title, '', COALESCE(p.source_url, ''),
  '{}', p.created_at, p.updated_at
FROM publications p
WHERE NOT EXISTS (
  SELECT 1 FROM publication_segments ps WHERE ps.publication_id = p.id
);

INSERT INTO publication_segment_media (segment_id, media_id, display_order, settings_json)
SELECT 'legacy:' || r.publication_id, rm.media_id, rm.display_order, '{}'
FROM renditions r
JOIN rendition_media rm ON rm.rendition_id = r.id
WHERE NOT EXISTS (
  SELECT 1
  FROM renditions earlier
  WHERE earlier.publication_id = r.publication_id
    AND (
      earlier.created_at < r.created_at OR
      (earlier.created_at = r.created_at AND earlier.id < r.id)
    )
)
AND NOT EXISTS (
  SELECT 1
  FROM publication_segment_media psm
  WHERE psm.segment_id = 'legacy:' || r.publication_id
    AND psm.media_id = rm.media_id
);

INSERT INTO rendition_segments (
  id, rendition_id, publication_segment_id, position, body, title,
  description, url, settings_json, status, external_id, external_url,
  error_message, created_at, updated_at
)
SELECT
  'legacy:' || r.id, r.id, 'legacy:' || r.publication_id, 0, r.body, r.title,
  r.description, '', r.settings_json, r.status, COALESCE(r.external_id, ''),
  COALESCE(r.external_url, ''), COALESCE(r.error_message, ''), r.created_at, r.updated_at
FROM renditions r
WHERE NOT EXISTS (
  SELECT 1 FROM rendition_segments rs WHERE rs.rendition_id = r.id
);

INSERT INTO rendition_segment_media (
  rendition_segment_id, media_id, role, display_order, alt_text,
  thumbnail_timestamp_ms, settings_json
)
SELECT
  'legacy:' || rm.rendition_id, rm.media_id, rm.role, rm.display_order,
  COALESCE(rm.alt_text, ''), rm.thumbnail_timestamp_ms, '{}'
FROM rendition_media rm
WHERE NOT EXISTS (
  SELECT 1
  FROM rendition_segment_media rsm
  WHERE rsm.rendition_segment_id = 'legacy:' || rm.rendition_id
    AND rsm.media_id = rm.media_id
);
