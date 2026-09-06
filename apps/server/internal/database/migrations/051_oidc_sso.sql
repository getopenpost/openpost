ALTER TABLE users ADD COLUMN is_break_glass BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE api_tokens ADD COLUMN organization_id TEXT;
ALTER TABLE api_tokens ADD COLUMN identity_provider_id TEXT;
ALTER TABLE api_tokens ADD COLUMN assured_at DATETIME;

ALTER TABLE mcp_oauth_codes ADD COLUMN organization_id TEXT;
ALTER TABLE mcp_oauth_codes ADD COLUMN identity_provider_id TEXT;
ALTER TABLE mcp_oauth_codes ADD COLUMN assured_at DATETIME;
ALTER TABLE mcp_oauth_codes ADD COLUMN token_expires_at DATETIME;

ALTER TABLE cli_auth_sessions ADD COLUMN workspace_id TEXT;
ALTER TABLE cli_auth_sessions ADD COLUMN organization_id TEXT;
ALTER TABLE cli_auth_sessions ADD COLUMN identity_provider_id TEXT;
ALTER TABLE cli_auth_sessions ADD COLUMN assured_at DATETIME;
ALTER TABLE cli_auth_sessions ADD COLUMN token_expires_at DATETIME;

CREATE TABLE IF NOT EXISTS identity_providers (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  source TEXT NOT NULL DEFAULT 'database',
  issuer TEXT NOT NULL,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_encrypted BLOB,
  scopes TEXT NOT NULL DEFAULT 'openid profile email',
  email_claim TEXT NOT NULL DEFAULT 'email',
  name_claim TEXT NOT NULL DEFAULT 'name',
  picture_claim TEXT NOT NULL DEFAULT 'picture',
  use_userinfo BOOLEAN NOT NULL DEFAULT false,
  require_verified_email BOOLEAN NOT NULL DEFAULT true,
  jit_enabled BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  health_status TEXT NOT NULL DEFAULT 'unchecked',
  health_message TEXT NOT NULL DEFAULT '',
  last_checked_at DATETIME,
  created_by_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  updated_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, issuer)
);

CREATE INDEX IF NOT EXISTS identity_providers_org_active_idx
  ON identity_providers (organization_id, is_active);

CREATE TABLE IF NOT EXISTS user_identities (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  linked_email TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  last_login_at DATETIME,
  FOREIGN KEY (provider_id) REFERENCES identity_providers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (provider_id, subject),
  UNIQUE (provider_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_identities_user_idx
  ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS oidc_auth_requests (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  organization_id TEXT,
  state_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL,
  browser_binding_hash TEXT NOT NULL,
  pkce_verifier_encrypted BLOB NOT NULL,
  intent TEXT NOT NULL,
  reauth_action TEXT NOT NULL DEFAULT '',
  return_path TEXT NOT NULL DEFAULT '/',
  native BOOLEAN NOT NULL DEFAULT false,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (provider_id) REFERENCES identity_providers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oidc_auth_requests_expiry_idx
  ON oidc_auth_requests (expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS organization_sso_policies (
  organization_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'disabled',
  provider_ids TEXT NOT NULL DEFAULT '[]',
  assurance_max_age_seconds INTEGER NOT NULL DEFAULT 43200,
  password_login_allowed BOOLEAN NOT NULL DEFAULT true,
  api_token_mode TEXT NOT NULL DEFAULT 'scoped',
  max_token_lifetime_seconds INTEGER NOT NULL DEFAULT 2592000,
  require_token_reauth BOOLEAN NOT NULL DEFAULT true,
  updated_by_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  updated_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS identity_provider_domains (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  verification_hash TEXT NOT NULL,
  verified_at DATETIME,
  created_by_user_id TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (provider_id) REFERENCES identity_providers(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS identity_provider_domains_lookup_idx
  ON identity_provider_domains (domain, verified_at);

CREATE TABLE IF NOT EXISTS session_identity_assurances (
  session_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  auth_time DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  acr TEXT NOT NULL DEFAULT '',
  amr TEXT NOT NULL DEFAULT '[]',
  upstream_sid TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (session_id, provider_id),
  FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_id) REFERENCES identity_providers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_identity_assurances_user_provider_idx
  ON session_identity_assurances (user_id, provider_id, expires_at);

CREATE INDEX IF NOT EXISTS session_identity_assurances_upstream_sid_idx
  ON session_identity_assurances (provider_id, upstream_sid);

CREATE TABLE IF NOT EXISTS reauth_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  provider_id TEXT,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_id) REFERENCES identity_providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reauth_grants_active_idx
  ON reauth_grants (user_id, session_id, action, expires_at);

CREATE TABLE IF NOT EXISTS oidc_native_handoffs (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  action TEXT NOT NULL DEFAULT '',
  token_encrypted BLOB NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oidc_native_handoffs_expiry_idx
  ON oidc_native_handoffs (expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS oidc_logout_events (
  provider_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (provider_id, token_hash),
  FOREIGN KEY (provider_id) REFERENCES identity_providers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS identity_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  provider_id TEXT,
  actor_user_id TEXT,
  subject_user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_id) REFERENCES identity_providers(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (subject_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS identity_audit_events_org_created_idx
  ON identity_audit_events (organization_id, created_at);

INSERT INTO organization_members (organization_id, user_id, role, created_at)
SELECT DISTINCT
  w.organization_id,
  wm.user_id,
  'member',
  current_timestamp
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
WHERE w.organization_id IS NOT NULL
  AND w.organization_id != ''
  AND NOT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = w.organization_id
      AND om.user_id = wm.user_id
  );
