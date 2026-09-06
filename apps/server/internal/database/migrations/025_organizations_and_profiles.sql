CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS organization_members_user_idx
  ON organization_members (user_id);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by_user_id TEXT NOT NULL,
  accepted_by_user_id TEXT,
  default_workspace_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME,
  revoked_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (default_workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS organization_invitations_org_status_idx
  ON organization_invitations (organization_id, accepted_at, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS organization_invitations_email_idx
  ON organization_invitations (organization_id, email);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE workspaces ADD COLUMN organization_id TEXT;

ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar_object_key TEXT NOT NULL DEFAULT '';

INSERT INTO organizations (id, name, created_by, created_at, updated_at)
SELECT
  'org_' || w.id,
  w.name,
  COALESCE((
    SELECT wm.user_id
    FROM workspace_members wm
    WHERE wm.workspace_id = w.id
    ORDER BY CASE WHEN wm.role = 'admin' THEN 0 ELSE 1 END, wm.user_id
    LIMIT 1
  ), ''),
  COALESCE(w.created_at, current_timestamp),
  current_timestamp
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM organizations o WHERE o.id = 'org_' || w.id
);

UPDATE workspaces
SET organization_id = 'org_' || id
WHERE organization_id IS NULL OR organization_id = '';

INSERT INTO organization_members (organization_id, user_id, role, created_at)
SELECT DISTINCT
  w.organization_id,
  wm.user_id,
  CASE WHEN wm.role = 'admin' THEN 'owner' ELSE 'member' END,
  current_timestamp
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
WHERE w.organization_id IS NOT NULL
  AND w.organization_id != ''
  AND NOT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = w.organization_id AND om.user_id = wm.user_id
  );

ALTER TABLE billing_subscriptions ADD COLUMN organization_id TEXT;

UPDATE billing_subscriptions
SET organization_id = (
  SELECT w.organization_id FROM workspaces w WHERE w.id = billing_subscriptions.workspace_id
)
WHERE organization_id IS NULL OR organization_id = '';

CREATE TABLE IF NOT EXISTS billing_subscriptions_v25 (
  organization_id TEXT PRIMARY KEY,
  workspace_id TEXT,
  provider TEXT NOT NULL DEFAULT 'polar',
  provider_customer_id TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL UNIQUE,
  provider_product_id TEXT,
  provider_price_id TEXT,
  status TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  entitlement_snapshot TEXT NOT NULL DEFAULT '{}',
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  raw_payload TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

INSERT INTO billing_subscriptions_v25 (
  organization_id,
  workspace_id,
  provider,
  provider_customer_id,
  provider_subscription_id,
  provider_product_id,
  provider_price_id,
  status,
  plan_id,
  entitlement_snapshot,
  current_period_end,
  cancel_at_period_end,
  raw_payload,
  created_at,
  updated_at
)
SELECT
  COALESCE(NULLIF(bs.organization_id, ''), w.organization_id, 'org_' || bs.workspace_id),
  bs.workspace_id,
  bs.provider,
  bs.provider_customer_id,
  bs.provider_subscription_id,
  bs.provider_product_id,
  bs.provider_price_id,
  bs.status,
  bs.plan_id,
  bs.entitlement_snapshot,
  bs.current_period_end,
  bs.cancel_at_period_end,
  bs.raw_payload,
  bs.created_at,
  bs.updated_at
FROM billing_subscriptions bs
LEFT JOIN workspaces w ON w.id = bs.workspace_id
WHERE NOT EXISTS (
  SELECT 1
  FROM billing_subscriptions_v25 existing
  WHERE existing.organization_id = COALESCE(NULLIF(bs.organization_id, ''), w.organization_id, 'org_' || bs.workspace_id)
);

DROP TABLE billing_subscriptions;

ALTER TABLE billing_subscriptions_v25 RENAME TO billing_subscriptions;

CREATE INDEX IF NOT EXISTS billing_subscriptions_provider_customer_idx
  ON billing_subscriptions (provider, provider_customer_id);

CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx
  ON billing_subscriptions (status);

CREATE INDEX IF NOT EXISTS billing_subscriptions_workspace_idx
  ON billing_subscriptions (workspace_id);
