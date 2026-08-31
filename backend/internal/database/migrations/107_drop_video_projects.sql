-- 107: Remove the retired cloud-synced Video Editor storage. Editing is now
-- fully local-first in a workspace folder on the user's disk, so project
-- heads, revision snapshots, assets, and composer return tokens have no
-- remaining writers or readers.

DROP TABLE IF EXISTS video_return_tokens;
DROP TABLE IF EXISTS video_revision_media_index_state;
DROP TABLE IF EXISTS video_project_assets;
DROP TABLE IF EXISTS video_project_revisions;
DROP TABLE IF EXISTS video_projects;

-- media_attachments.video_project_id is dropped idempotently by the migration
-- runner because databases that never ran the video editor migrations do not
-- have the column.
