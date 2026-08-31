CREATE TABLE IF NOT EXISTS provider_apps (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  client_secret_encrypted BLOB,
  redirect_uri TEXT NOT NULL DEFAULT '',
  instance_url TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE provider_apps ADD COLUMN connection_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_apps ADD COLUMN bot_token_encrypted BLOB;
ALTER TABLE provider_apps ADD COLUMN bot_username TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_apps ADD COLUMN webhook_secret_encrypted BLOB;
