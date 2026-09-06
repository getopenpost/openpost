CREATE TABLE IF NOT EXISTS workspace_invitation_delivery_events (
  event_id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invitation_id) REFERENCES workspace_invitations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workspace_invitation_delivery_events_invitation_idx
  ON workspace_invitation_delivery_events (invitation_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS workspace_invitation_resends (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  resent_at TIMESTAMP NOT NULL,
  FOREIGN KEY (invitation_id) REFERENCES workspace_invitations(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workspace_invitation_resends_limit_idx
  ON workspace_invitation_resends (invitation_id, actor_user_id, resent_at ASC);
