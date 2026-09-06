CREATE TABLE IF NOT EXISTS x_engagement_read_budgets (
  social_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  window_start TIMESTAMP NOT NULL,
  attempts_used INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMP,
  block_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS x_engagement_read_budgets_window_idx
  ON x_engagement_read_budgets (window_start, attempts_used);
