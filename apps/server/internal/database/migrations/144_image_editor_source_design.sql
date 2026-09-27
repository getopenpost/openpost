ALTER TABLE design_documents ADD COLUMN source_media_id TEXT REFERENCES media_attachments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX design_documents_active_source_idx
ON design_documents(workspace_id, source_media_id)
WHERE deleted_at IS NULL AND source_media_id IS NOT NULL;
