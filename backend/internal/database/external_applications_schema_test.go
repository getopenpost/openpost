package database

import (
	"testing"

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
}
