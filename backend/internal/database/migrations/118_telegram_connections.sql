ALTER TABLE bot_connection_nonces
  ADD COLUMN expected_subject_reference TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS telegram_chat_installations (
  chat_id TEXT PRIMARY KEY,
  chat_type TEXT NOT NULL,
  membership_status TEXT NOT NULL,
  installed_at DATETIME,
  updated_at DATETIME NOT NULL,
  CHECK (chat_id <> '' AND LENGTH(chat_id) <= 64),
  CHECK (chat_type IN ('channel', 'group', 'supergroup')),
  CHECK (membership_status IN ('creator', 'administrator', 'member', 'restricted', 'left', 'kicked'))
);

CREATE TABLE IF NOT EXISTS telegram_connections (
  social_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  chat_id TEXT NOT NULL UNIQUE,
  chat_type TEXT NOT NULL,
  installed_at DATETIME NOT NULL,
  coverage_started_at DATETIME NOT NULL,
  coverage_kind TEXT NOT NULL,
  permissions_verified_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CHECK (chat_id <> '' AND LENGTH(chat_id) <= 64),
  CHECK (chat_type IN ('channel', 'group', 'supergroup')),
  CHECK (coverage_kind = 'since_installation'),
  CHECK (coverage_started_at >= installed_at)
);

CREATE INDEX IF NOT EXISTS telegram_connections_workspace_idx
  ON telegram_connections (workspace_id, created_at);
