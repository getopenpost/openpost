package database

import (
	"database/sql"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCreateSchemaBuildsExternalApplicationIntegrationTables(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))

	var applied int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM schema_migrations WHERE version = 129").Scan(t.Context(), &applied))
	require.Equal(t, 1, applied)

	for _, table := range []string{
		"external_applications",
		"external_app_installations",
		"external_app_workspace_grants",
		"external_app_account_grants",
		"external_oauth_codes",
		"external_refresh_tokens",
		"external_webhook_subscriptions",
		"external_webhook_deliveries",
	} {
		var count int
		require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", table).Scan(t.Context(), &count))
		require.Equal(t, 1, count, table)
	}

	var installationColumn int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM pragma_table_info('api_tokens') WHERE name = 'installation_id'").Scan(t.Context(), &installationColumn))
	require.Equal(t, 1, installationColumn)

	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.User{ID: "operator-1", Email: "operator@example.test", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalApplication{
		ID: "application-1", ClientID: "client-1", Name: "App", ClientType: "public",
		RedirectURIsJSON: `[]`, AllowedScopes: "workspace:read", CreatedByUserID: "operator-1",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewDelete().Model((*models.User)(nil)).Where("id = ?", "operator-1").Exec(t.Context())
	require.NoError(t, err)
	var createdBy sql.NullString
	require.NoError(t, db.NewRaw("SELECT created_by_user_id FROM external_applications WHERE id = ?", "application-1").Scan(t.Context(), &createdBy))
	require.False(t, createdBy.Valid)
}
