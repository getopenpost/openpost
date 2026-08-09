package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestMediaGenerationRecipesMigrationKeepsRecipeWithMediaAndWorkspace(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)
	`)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "creator@example.com"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-1", WorkspaceID: "workspace-1", FilePath: "memes/media-1.png",
	}).Exec(ctx)
	require.NoError(t, err)

	sqlBytes, err := migrationFiles.ReadFile("074_media_generation_recipes.sql")
	require.NoError(t, err)
	require.NoError(t, runMigration(ctx, db, migration{
		version: 74,
		name:    "074_media_generation_recipes.sql",
		sql:     string(sqlBytes),
	}))

	recipe := &models.MediaGenerationRecipe{
		MediaID:           "media-1",
		WorkspaceID:       "workspace-1",
		CreatedByID:       "user-1",
		Kind:              "meme",
		RendererKey:       "memegen",
		TemplateID:        "drake",
		TemplateName:      "Drake Hotline Bling",
		TemplateSourceURL: "https://example.com/source",
		CatalogRevision:   "catalog-v1",
		RecipeJSON:        `{"captions":["no","yes"]}`,
	}
	_, err = db.NewInsert().Model(recipe).Exec(ctx)
	require.NoError(t, err)

	var stored models.MediaGenerationRecipe
	require.NoError(t, db.NewSelect().Model(&stored).Where("media_id = ?", "media-1").Scan(ctx))
	require.Equal(t, recipe.RecipeJSON, stored.RecipeJSON)
	require.Equal(t, recipe.TemplateSourceURL, stored.TemplateSourceURL)

	_, err = db.NewDelete().Model((*models.User)(nil)).Where("id = ?", "user-1").Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().Model(&stored).Where("media_id = ?", "media-1").Scan(ctx))
	require.Empty(t, stored.CreatedByID)

	_, err = db.NewDelete().Model((*models.MediaAttachment)(nil)).Where("id = ?", "media-1").Exec(ctx)
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.MediaGenerationRecipe)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}
