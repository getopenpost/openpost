CREATE TABLE IF NOT EXISTS user_workspace_queue_reminders (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  low_runway_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  queue_emptied_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  runway_days INTEGER NOT NULL DEFAULT 7 CHECK (runway_days BETWEEN 1 AND 30),
  low_runway_active BOOLEAN NOT NULL DEFAULT FALSE,
  queue_emptied_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, workspace_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queue_reminders_workspace
  ON user_workspace_queue_reminders (workspace_id);
