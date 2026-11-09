-- Workspaces opt in to client approval for every post; existing workspaces keep per-post review.
ALTER TABLE workspaces ADD COLUMN require_client_review BOOLEAN NOT NULL DEFAULT FALSE;
