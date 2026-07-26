-- Social sets are no longer part of the product model. Keep posting schedules
-- workspace-scoped and drop the old grouping tables.

CREATE TABLE IF NOT EXISTS posting_schedules (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    set_id TEXT,
    utc_hour INTEGER NOT NULL DEFAULT 0,
    utc_minute INTEGER NOT NULL DEFAULT 0,
    day_of_week INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT current_timestamp
);

UPDATE posting_schedules SET set_id = '' WHERE set_id IS NOT NULL;

DROP TABLE IF EXISTS social_media_set_accounts;
DROP TABLE IF EXISTS social_media_sets;
