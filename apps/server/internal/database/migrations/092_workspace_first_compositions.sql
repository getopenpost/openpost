CREATE TABLE IF NOT EXISTS workspace_first_compositions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  signal TEXT NOT NULL CHECK (signal IN ('text', 'media', 'content_mode')),
  origin_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Historical migration fixtures can omit this earlier table. Production
-- databases already have the canonical definition from migration 018.
CREATE TABLE IF NOT EXISTS publication_assets (
  publication_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (publication_id, media_id)
);

INSERT INTO workspace_first_compositions (workspace_id, signal, created_at)
SELECT
  publication.workspace_id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM publication_assets AS asset
      WHERE asset.publication_id = publication.id
    ) THEN 'media'
    WHEN publication.intent = 'thread' THEN 'content_mode'
    ELSE 'text'
  END,
  publication.created_at
FROM publications AS publication
WHERE (
  TRIM(publication.source_text) != ''
  OR publication.intent = 'thread'
  OR EXISTS (
    SELECT 1 FROM publication_assets AS asset
    WHERE asset.publication_id = publication.id
  )
)
AND NOT EXISTS (
  SELECT 1
  FROM publications AS earlier
  WHERE earlier.workspace_id = publication.workspace_id
    AND (
      TRIM(earlier.source_text) != ''
      OR earlier.intent = 'thread'
      OR EXISTS (
        SELECT 1 FROM publication_assets AS earlier_asset
        WHERE earlier_asset.publication_id = earlier.id
      )
    )
    AND (
      earlier.created_at < publication.created_at
      OR (earlier.created_at = publication.created_at AND earlier.id < publication.id)
    )
)
ON CONFLICT (workspace_id) DO NOTHING;
