ALTER TABLE publications ADD COLUMN creation_source TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX idx_publications_workspace_creation_source_created
    ON publications (workspace_id, creation_source, created_at);
