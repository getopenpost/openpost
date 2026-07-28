-- 010: Add stable user-editable social account slugs for CLI selectors and UI labels.

ALTER TABLE social_accounts ADD COLUMN slug TEXT NOT NULL DEFAULT '';

UPDATE social_accounts
SET slug = lower(platform || '-' || replace(substr(id, 1, 8), '-', ''))
WHERE slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_workspace_slug_active_idx
    ON social_accounts (workspace_id, slug)
    WHERE is_active = 1 AND slug != '';
