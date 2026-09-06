-- Some operator and migration-test databases intentionally contain only a
-- subset of the application schema. Keep the lifecycle migration replayable
-- there without changing full installations, where this table already exists.
CREATE TABLE IF NOT EXISTS media_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL DEFAULT 'library',
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

ALTER TABLE media_attachments ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'library';
ALTER TABLE media_attachments ADD COLUMN last_used_at TIMESTAMP NULL;
ALTER TABLE media_attachments ADD COLUMN trashed_at TIMESTAMP NULL;
ALTER TABLE media_attachments ADD COLUMN purge_after TIMESTAMP NULL;
ALTER TABLE media_attachments ADD COLUMN trash_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE media_attachments ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE media_attachments ADD COLUMN file_hash TEXT NULL;

UPDATE media_attachments
SET last_used_at = created_at
WHERE last_used_at IS NULL;

UPDATE media_attachments
SET asset_kind = 'library', retention_class = 'library'
WHERE asset_kind = 'brand_asset'
  AND (
    source <> 'upload'
    OR file_hash IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM media_attachments AS existing
      WHERE existing.workspace_id = media_attachments.workspace_id
        AND existing.file_hash = media_attachments.file_hash
        AND existing.source = 'upload'
        AND (
          existing.asset_kind = 'library'
          OR (
            existing.asset_kind = 'brand_asset'
            AND existing.id < media_attachments.id
          )
        )
    )
  );

CREATE INDEX IF NOT EXISTS media_attachments_workspace_lifecycle_idx
  ON media_attachments (workspace_id, retention_class, trashed_at, last_used_at);

CREATE INDEX IF NOT EXISTS media_attachments_purge_after_idx
  ON media_attachments (purge_after)
  WHERE purge_after IS NOT NULL;
