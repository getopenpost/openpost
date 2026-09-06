CREATE TABLE IF NOT EXISTS organization_ownership_transfers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prior_owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nominee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME,
  declined_at DATETIME,
  revoked_at DATETIME,
  expired_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  CHECK (prior_owner_user_id <> nominee_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_ownership_transfers_pending_idx
  ON organization_ownership_transfers (organization_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS organization_ownership_transfers_nominee_idx
  ON organization_ownership_transfers (nominee_user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS organization_ownership_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transfer_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  nominee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (result IN ('succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS organization_ownership_audit_org_created_idx
  ON organization_ownership_audit_events (organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS organization_ownership_audit_transfer_idx
  ON organization_ownership_audit_events (transfer_id, created_at DESC, id DESC);
