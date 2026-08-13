package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsImageEditorDesignFavorites(t *testing.T) {
	t.Parallel()

	db := newPostVariantsTestDB(t)
	ctx := context.Background()

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	exists, err := migrationColumnExists(ctx, db, "design_documents", "is_favorite")
	require.NoError(t, err)
	require.True(t, exists)

	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "OpenPost Image Editor"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "studio@example.com",
		PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DesignDocument{
		ID:          "design-1",
		WorkspaceID: "workspace-1",
		CreatedByID: "user-1",
		Title:       "Design",
		WidthPX:     1080,
		HeightPX:    1080,
	}).Exec(ctx)
	require.NoError(t, err)

	var defaultValue bool
	require.NoError(t, db.NewSelect().
		TableExpr("design_documents").
		Column("is_favorite").
		Limit(1).
		Scan(ctx, &defaultValue))
}
