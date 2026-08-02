-- 054: Query and retention indexes used by Video Studio private-beta sync and recovery.

CREATE INDEX IF NOT EXISTS video_projects_workspace_revision_idx
  ON video_projects (workspace_id, revision);

CREATE INDEX IF NOT EXISTS video_project_revisions_project_expiry_idx
  ON video_project_revisions (video_project_id, expires_at);

CREATE INDEX IF NOT EXISTS video_return_tokens_project_idx
  ON video_return_tokens (project_id);
