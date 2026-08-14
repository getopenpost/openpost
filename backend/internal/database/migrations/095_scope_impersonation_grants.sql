CREATE TABLE IF NOT EXISTS user_impersonation_grant_organizations (
  grant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  PRIMARY KEY (grant_id, organization_id),
  FOREIGN KEY (grant_id) REFERENCES user_impersonation_grants(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS impersonation_grant_organizations_org_grant_idx
  ON user_impersonation_grant_organizations (organization_id, grant_id);
