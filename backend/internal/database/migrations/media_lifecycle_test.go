package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMediaLifecycleMigrationPreservesCollidingBrandAssets(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	_, err := db.ExecContext(ctx, `DROP TABLE media_attachments`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at INTEGER NOT NULL
		);
		CREATE TABLE media_attachments (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			file_hash TEXT,
			source TEXT NOT NULL DEFAULT 'upload',
			asset_kind TEXT NOT NULL DEFAULT 'library',
			is_favorite BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		);
		CREATE UNIQUE INDEX media_workspace_hash_idx
			ON media_attachments (workspace_id, file_hash)
			WHERE source = 'upload' AND asset_kind = 'library';
		INSERT INTO media_attachments (id, workspace_id, file_hash, asset_kind) VALUES
			('library', 'workspace', 'shared-hash', 'library'),
			('brand-collision', 'workspace', 'shared-hash', 'brand_asset'),
			('brand-unique', 'workspace', 'unique-hash', 'brand_asset')
	`)
	require.NoError(t, err)

	sqlBytes, err := migrationFiles.ReadFile("069_media_lifecycle.sql")
	require.NoError(t, err)
	require.NoError(t, runMigration(ctx, db, migration{
		version: 69,
		name:    "069_media_lifecycle.sql",
		sql:     string(sqlBytes),
	}))

	var rows []struct {
		ID        string `bun:"id"`
		AssetKind string `bun:"asset_kind"`
	}
	require.NoError(t, db.NewRaw(`SELECT id, asset_kind FROM media_attachments ORDER BY id`).Scan(ctx, &rows))
	kinds := make(map[string]string, len(rows))
	for _, row := range rows {
		kinds[row.ID] = row.AssetKind
	}
	require.Equal(t, "brand_asset", kinds["brand-collision"])
	require.Equal(t, "library", kinds["brand-unique"])
	require.Equal(t, "library", kinds["library"])
}
