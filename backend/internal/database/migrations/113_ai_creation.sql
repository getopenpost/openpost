CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL DEFAULT 1,
  definition_json TEXT NOT NULL DEFAULT '{}',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, normalized_name),
  UNIQUE (id, workspace_id),
  CHECK (name <> ''),
  CHECK (revision >= 1),
  CHECK (schema_version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_one_default_idx
  ON voice_profiles (workspace_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS voice_profiles_workspace_idx
  ON voice_profiles (workspace_id, updated_at DESC);

INSERT INTO voice_profiles (
  id,
  workspace_id,
  name,
  normalized_name,
  is_default,
  revision,
  schema_version,
  definition_json,
  created_by_id
)
SELECT
  'default:' || w.id,
  w.id,
  w.name,
  LOWER(w.name),
  TRUE,
  1,
  1,
  '{}',
  ''
FROM workspaces AS w
WHERE NOT EXISTS (
  SELECT 1 FROM voice_profiles AS existing WHERE existing.workspace_id = w.id
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS voice_profile_account_assignments (
  social_account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  voice_profile_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_account_id, workspace_id)
    REFERENCES social_accounts(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (voice_profile_id, workspace_id)
    REFERENCES voice_profiles(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS voice_profile_assignments_workspace_idx
  ON voice_profile_account_assignments (workspace_id, voice_profile_id);

CREATE TABLE IF NOT EXISTS publication_builds (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  publication_id TEXT,
  state TEXT NOT NULL,
  phase TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  authority_json TEXT NOT NULL DEFAULT '{}',
  request_json TEXT NOT NULL,
  voice_snapshot_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  model TEXT NOT NULL DEFAULT '',
  provider_request_id TEXT NOT NULL DEFAULT '',
  usage_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, created_by_id, idempotency_key),
  UNIQUE (publication_id),
  CHECK (state IN ('queued', 'building', 'ready', 'committed', 'failed', 'cancelled')),
  CHECK (phase IN ('queued', 'sources', 'directing', 'drafting', 'reviewing', 'ready', 'committing', 'committed', 'failed', 'cancelled')),
  CHECK (revision >= 1),
  CHECK (idempotency_key <> ''),
  CHECK (request_fingerprint <> '')
);

CREATE INDEX IF NOT EXISTS publication_builds_workspace_idx
  ON publication_builds (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS publication_builds_state_idx
  ON publication_builds (state, updated_at);

CREATE TABLE IF NOT EXISTS publication_build_assets (
  build_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'context',
  may_publish BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (build_id, media_id),
  FOREIGN KEY (build_id) REFERENCES publication_builds(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE,
  CHECK (role IN ('context', 'evidence', 'artifact')),
  CHECK (display_order >= 0)
);

CREATE INDEX IF NOT EXISTS publication_build_assets_media_idx
  ON publication_build_assets (media_id, build_id);
