CREATE TABLE IF NOT EXISTS workspace_first_connections (
  workspace_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  origin_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO workspace_first_connections (workspace_id, account_id)
SELECT account.workspace_id, account.id
FROM social_accounts AS account
WHERE NOT EXISTS (
  SELECT 1
  FROM social_accounts AS earlier
  WHERE earlier.workspace_id = account.workspace_id
    AND (
      earlier.created_at < account.created_at
      OR (earlier.created_at = account.created_at AND earlier.id < account.id)
    )
)
ON CONFLICT (workspace_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS oauth_account_selection_reservations (
  selection_id TEXT PRIMARY KEY REFERENCES oauth_account_selections(id) ON DELETE CASCADE,
  reserved_at TIMESTAMP NOT NULL
);
