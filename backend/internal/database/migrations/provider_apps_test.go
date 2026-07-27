package migrations

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesProviderAppsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'provider_apps'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "provider TEXT NOT NULL")
	require.Contains(t, schema, "client_secret_encrypted BLOB")
	require.Contains(t, schema, "instance_url TEXT NOT NULL DEFAULT ''")
	require.Contains(t, schema, "is_active BOOLEAN NOT NULL DEFAULT TRUE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('provider_apps_provider_instance_idx', 'provider_apps_active_provider_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}

func TestRunMigrationsProviderAppsEnforcesOneAppPerProviderInstance(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	require.NoError(t, RunMigrations(db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id)
		VALUES ('x-1', 'x', 'client-1')
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id)
		VALUES ('x-2', 'x', 'client-2')
	`)
	require.Error(t, err)
	require.Contains(t, strings.ToLower(err.Error()), "unique")

	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id, instance_url)
		VALUES ('mastodon-1', 'mastodon', 'client-1', 'https://masto.pt')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_apps (id, provider, client_id, instance_url)
		VALUES ('mastodon-2', 'mastodon', 'client-2', 'https://example.social')
	`)
	require.NoError(t, err)
}
