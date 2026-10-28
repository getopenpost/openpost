ALTER TABLE engagement_items ADD COLUMN automation_stopped_at DATETIME;
ALTER TABLE engagement_items ADD COLUMN replied_at DATETIME;
CREATE TABLE engagement_automation_replies (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL REFERENCES engagement_items(id) ON DELETE CASCADE,
 workflow_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 step_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 channel TEXT NOT NULL,
 recipient_key TEXT NOT NULL DEFAULT '',
 body TEXT NOT NULL,
 item_body TEXT NOT NULL,
 state TEXT NOT NULL,
 job_id TEXT NOT NULL DEFAULT '',
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE(item_id, channel),
 UNIQUE(run_id, step_id)
);
CREATE INDEX engagement_automation_workspace_state_idx ON engagement_automation_replies(workspace_id, state, created_at);
CREATE INDEX engagement_automation_workflow_idx ON engagement_automation_replies(workflow_id, state);
CREATE INDEX engagement_comment_source_idx ON engagement_items(workspace_id, kind, created_at, id);

CREATE UNIQUE INDEX engagement_private_recipient_idx ON engagement_automation_replies(workspace_id, recipient_key) WHERE recipient_key <> '' AND channel = 'private';
CREATE TABLE engagement_automation_optouts (
 social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
 author_remote_id TEXT NOT NULL,
 created_at DATETIME NOT NULL,
 PRIMARY KEY(social_account_id,author_remote_id)
);
