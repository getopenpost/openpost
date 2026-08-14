ALTER TABLE workspace_invitations
  ADD COLUMN email_delivery_status TEXT NOT NULL DEFAULT 'unavailable';

ALTER TABLE workspace_invitations
  ADD COLUMN email_delivery_job_id TEXT NOT NULL DEFAULT '';
