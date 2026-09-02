DROP INDEX IF EXISTS organization_theme_assets_org_idx;

CREATE INDEX IF NOT EXISTS organization_theme_assets_page_idx
  ON organization_theme_assets (organization_id, created_at DESC, id ASC);
