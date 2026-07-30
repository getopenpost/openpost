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

CREATE UNIQUE INDEX IF NOT EXISTS provider_apps_provider_instance_idx
  ON provider_apps (provider, instance_url);

CREATE INDEX IF NOT EXISTS provider_apps_active_provider_idx
  ON provider_apps (is_active, provider);
