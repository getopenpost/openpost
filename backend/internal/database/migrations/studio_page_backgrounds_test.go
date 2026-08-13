package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestImageEditorPageBackgroundMigration(t *testing.T) {
	t.Parallel()

	db := newPostVariantsTestDB(t)
	ctx := context.Background()

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	exists, err := migrationColumnExists(ctx, db, "design_pages", "background_json")
	require.NoError(t, err)
	require.True(t, exists)

	exists, err = migrationColumnExists(ctx, db, "design_documents", "export_matte_color")
	require.NoError(t, err)
	require.True(t, exists)
}
