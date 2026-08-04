package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsStudioExportDefaults(t *testing.T) {
	t.Parallel()

	db := newPostVariantsTestDB(t)
	ctx := context.Background()

	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))

	for _, column := range []string{"export_format", "export_quality"} {
		exists, err := migrationColumnExists(ctx, db, "design_documents", column)
		require.NoError(t, err)
		require.True(t, exists)
	}
}
