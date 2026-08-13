package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestPublicationTextEditorMigrationBackfillsExistingDrafts(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	for _, model := range []interface{}{
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	seedMigrationUser(ctx, t, db)
	runMigrationsThrough(t, db, 40)

	_, err := db.NewInsert().Model(&models.Workspace{
		ID:   "workspace-editor",
		Name: "Editor migration",
	}).Exec(ctx)
	require.NoError(t, err)
	publication := models.Publication{
		ID:              "publication-editor",
		WorkspaceID:     "workspace-editor",
		CreatedByID:     "user-1",
		Title:           "Migrated draft",
		Intent:          models.PublishingIntentPost,
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Canonical fallback",
		SourceContent:   "Canonical fallback",
		Status:          models.PublicationStatusDraft,
		Revision:        4,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
	}
	_, err = db.NewInsert().Model(&publication).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationSegment{
		ID:            "segment-editor",
		PublicationID: publication.ID,
		Position:      0,
		Body:          "Canonical segment",
	}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	var editors []models.Post
	require.NoError(t, db.NewSelect().
		Model(&editors).
		Where("publication_id = ?", publication.ID).
		Scan(ctx))
	require.Len(t, editors, 1)
	require.Equal(t, "Canonical segment", editors[0].Content)
	require.Equal(t, models.PostStatusDraft, editors[0].Status)
	require.Equal(t, 4, editors[0].Revision)
}
