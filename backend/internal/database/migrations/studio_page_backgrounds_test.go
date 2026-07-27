package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStudioPageBackgroundMigration(t *testing.T) {
	db := newMigrationTestDB(t)
	ctx := context.Background()

	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))

	exists, err := migrationColumnExists(ctx, db, "design_pages", "background_json")
	require.NoError(t, err)
	require.True(t, exists)
}
