package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRemoveBrandAssetsMigrationDropsLegacyRoles(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		CREATE TABLE brand_assets (
			id TEXT PRIMARY KEY,
			media_id TEXT NOT NULL
		);
		INSERT INTO brand_assets (id, media_id) VALUES ('asset-1', 'media-1');
	`)
	require.NoError(t, err)

	sqlBytes, err := migrationFiles.ReadFile("070_remove_brand_assets.sql")
	require.NoError(t, err)
	require.NoError(t, runMigration(ctx, db, migration{
		version: 70,
		name:    "070_remove_brand_assets.sql",
		sql:     string(sqlBytes),
	}))

	var count int
	require.NoError(t, db.NewRaw(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'brand_assets'`,
	).Scan(ctx, &count))
	require.Zero(t, count)
}
