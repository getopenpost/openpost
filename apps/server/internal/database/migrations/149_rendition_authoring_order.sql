ALTER TABLE renditions ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY publication_id ORDER BY created_at, id) - 1 AS position
    FROM renditions
)
UPDATE renditions
SET position = (SELECT position FROM ordered WHERE ordered.id = renditions.id);

CREATE INDEX IF NOT EXISTS idx_renditions_publication_position ON renditions(publication_id, position, id);
