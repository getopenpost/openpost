CREATE TABLE IF NOT EXISTS workspace_activations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_analytics_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO workspace_activations (id, workspace_id, publication_id, created_at)
SELECT
  'activation:' || publication.workspace_id,
  publication.workspace_id,
  publication.id,
  publication.updated_at
FROM publications AS publication
WHERE publication.status IN ('scheduled', 'publishing', 'published', 'failed')
  AND NOT EXISTS (
    SELECT 1 FROM publications AS earlier
    WHERE earlier.workspace_id = publication.workspace_id
      AND earlier.status IN ('scheduled', 'publishing', 'published', 'failed')
      AND (
        earlier.created_at < publication.created_at
        OR (
          earlier.created_at = publication.created_at
          AND earlier.id < publication.id
        )
      )
  )
ON CONFLICT (workspace_id) DO NOTHING;

INSERT INTO product_analytics_events (id, workspace_id, name, created_at)
SELECT id, workspace_id, 'workspace activated', created_at
FROM workspace_activations
WHERE true
ON CONFLICT DO NOTHING;
