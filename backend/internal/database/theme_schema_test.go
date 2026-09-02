package database

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCreateSchemaBuildsOrganizationThemeLifecycleOnFreshSQLite(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))

	var applied int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM schema_migrations WHERE version = 128").Scan(t.Context(), &applied))
	require.Equal(t, 1, applied)
	for _, table := range []string{
		"organization_theme_settings", "organization_themes", "organization_theme_drafts",
		"organization_theme_revisions", "workspace_theme_assignments",
		"organization_theme_assets", "organization_theme_draft_assets", "organization_theme_revision_assets",
	} {
		var count int
		require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", table).Scan(t.Context(), &count))
		require.Equal(t, 1, count, table)
	}
	var catalogIndex int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'organization_theme_revisions_catalog_idx'").Scan(t.Context(), &catalogIndex))
	require.Equal(t, 1, catalogIndex)
	var assetPageIndex int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'organization_theme_assets_page_idx'").Scan(t.Context(), &assetPageIndex))
	require.Equal(t, 1, assetPageIndex)

	now := time.Date(2026, time.September, 2, 12, 0, 0, 0, time.UTC)
	_, err = db.NewInsert().Model(&models.User{ID: "theme-owner", Email: "theme-owner@example.com", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-theme", Name: "Theme org", CreatedByID: "theme-owner", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO organization_theme_settings (organization_id, default_reference_kind, default_reference_id, default_reference_version) VALUES ('org-theme', 'remote', 'workshop', 1)`)
	require.Error(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO organization_theme_assets (id, organization_id, kind, name, media_type, object_key, size_bytes, width, height, checksum_sha256, created_by) VALUES ('bad-raster', 'org-theme', 'illustration', 'Bad', 'image/png', 'bad', 8, 0, 0, 'hash', 'theme-owner')`)
	require.Error(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO organization_theme_assets (id, organization_id, kind, name, media_type, object_key, size_bytes, checksum_sha256, font_family, font_style, font_weight, license_acknowledged, created_by) VALUES ('font-without-native', 'org-theme', 'font', 'Bad font', 'font/woff2', 'font.woff2', 8, 'hash', 'Example', 'normal', 400, TRUE, 'theme-owner')`)
	require.Error(t, err)
}
