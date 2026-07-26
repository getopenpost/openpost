package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestBackfillPublicationTextEditorsCreatesOnlyTextAndThreadEditors(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	ctx := context.Background()
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.ThreadDraft)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}

	now := time.Date(2026, time.July, 26, 12, 0, 0, 0, time.UTC)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "OpenPost"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "editor@example.com",
		PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-1",
		WorkspaceID:    "workspace-1",
		Platform:       "x",
		AccountID:      "x-account",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)

	publications := []models.Publication{
		{
			ID:              "text-publication",
			WorkspaceID:     "workspace-1",
			CreatedByID:     "user-1",
			Title:           "Text",
			Intent:          models.PublishingIntentPost,
			ContentProfile:  models.ContentProfileShortText,
			SourceText:      "Canonical text",
			SourceContent:   "Canonical text",
			Status:          models.PublicationStatusDraft,
			Revision:        3,
			MetadataJSON:    "{}",
			ReleasePlanJSON: "{}",
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              "story-publication",
			WorkspaceID:     "workspace-1",
			CreatedByID:     "user-1",
			Title:           "Story",
			Intent:          models.PublishingIntentStory,
			ContentProfile:  models.ContentProfileStory,
			Status:          models.PublicationStatusDraft,
			Revision:        1,
			MetadataJSON:    "{}",
			ReleasePlanJSON: "{}",
			CreatedAt:       now,
			UpdatedAt:       now,
		},
	}
	_, err = db.NewInsert().Model(&publications).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationSegment{
		ID:            "segment-1",
		PublicationID: "text-publication",
		Body:          "Canonical text",
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-1",
		PublicationID:   "text-publication",
		SocialAccountID: "account-1",
		Platform:        "x",
		Profile:         models.ContentProfileShortText,
		Body:            "Canonical text",
		Status:          models.RenditionStatusDraft,
		SettingsJSON:    "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, backfillPublicationTextEditors(ctx, db))
	require.NoError(t, backfillPublicationTextEditors(ctx, db))

	var editors []models.Post
	require.NoError(t, db.NewSelect().Model(&editors).Order("publication_id ASC").Scan(ctx))
	require.Len(t, editors, 1)
	require.Equal(t, "text-publication", editors[0].PublicationID)
	require.Equal(t, "Canonical text", editors[0].Content)
	require.Equal(t, 3, editors[0].Revision)

	var destinations []models.PostDestination
	require.NoError(t, db.NewSelect().Model(&destinations).Scan(ctx))
	require.Len(t, destinations, 1)
	require.Equal(t, editors[0].ID, destinations[0].PostID)
	require.Equal(t, "account-1", destinations[0].SocialAccountID)
}
