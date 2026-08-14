CREATE TABLE IF NOT EXISTS workspace_lifecycle_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS workspace_lifecycle_audit_org_created_idx
  ON workspace_lifecycle_audit_events (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS workspace_lifecycle_audit_workspace_created_idx
  ON workspace_lifecycle_audit_events (workspace_id, created_at DESC, id DESC);
