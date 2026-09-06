ALTER TABLE repost_policies ADD COLUMN stages_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE repost_executions ADD COLUMN current_stage INTEGER NOT NULL DEFAULT 1;
ALTER TABLE repost_executions ADD COLUMN total_stages INTEGER NOT NULL DEFAULT 1;
ALTER TABLE repost_executions ADD COLUMN unrepost_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repost_executions ADD COLUMN stage_history_json TEXT NOT NULL DEFAULT '[]';
