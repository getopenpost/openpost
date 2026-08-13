package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestMediaUsageSummaryAllowsTerminalPostUsage(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Post)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
	)
	handler := &MediaHandler{db: db}
	ctx := context.Background()

	posts := []models.Post{
		{ID: "published-post", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "posted", Status: "published", ScheduledAt: time.Now()},
		{ID: "scheduled-post", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "later", Status: "scheduled", ScheduledAt: time.Now()},
		{ID: "failed-post", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "retry", Status: "failed", ScheduledAt: time.Now()},
	}
	_, err := db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)

	postMedia := []models.PostMedia{
		{PostID: "published-post", MediaID: "published-media"},
		{PostID: "scheduled-post", MediaID: "blocked-media"},
		{PostID: "failed-post", MediaID: "failed-media"},
	}
	_, err = db.NewInsert().Model(&postMedia).Exec(ctx)
	require.NoError(t, err)

	usage, err := handler.mediaUsageSummary(ctx, "ws-1", "published-media")
	require.NoError(t, err)
	require.Equal(t, mediaUsageSummary{Total: 1, Blocking: 0}, usage)

	usage, err = handler.mediaUsageSummary(ctx, "ws-1", "blocked-media")
	require.NoError(t, err)
	require.Equal(t, mediaUsageSummary{Total: 1, Blocking: 1}, usage)

	usage, err = handler.mediaUsageSummary(ctx, "ws-1", "failed-media")
	require.NoError(t, err)
	require.Equal(t, mediaUsageSummary{Total: 1, Blocking: 0}, usage)
}

func TestMediaUsageStatusBlocksOnlyActiveWork(t *testing.T) {
	t.Parallel()

	for _, status := range []string{
		models.PostStatusDraft,
		models.PostStatusScheduled,
		models.PostStatusPublishing,
		models.PublicationStatusReady,
	} {
		require.True(t, mediaUsageStatusBlocks(status), status)
	}
	for _, status := range []string{models.PostStatusPublished, models.PostStatusFailed} {
		require.False(t, mediaUsageStatusBlocks(status), status)
	}
}

func TestNormalizeMediaFilenamePreservesFormat(t *testing.T) {
	t.Parallel()

	name, err := normalizeMediaFilename("launch-card.png", "renamed launch card")
	require.NoError(t, err)
	require.Equal(t, "renamed launch card.png", name)

	name, err = normalizeMediaFilename("launch-card.PNG", "renamed.PNG")
	require.NoError(t, err)
	require.Equal(t, "renamed.PNG", name)

	_, err = normalizeMediaFilename("launch-card.png", "renamed.jpg")
	require.EqualError(t, err, "file extension cannot be changed")

	_, err = normalizeMediaFilename("launch-card.png", "folder/renamed.png")
	require.EqualError(t, err, "filename cannot contain path separators or control characters")
}

func TestMediaUsageSummaryUsesTerminalPublicationStatusForRenditions(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Post)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
	)
	handler := &MediaHandler{db: db}
	ctx := context.Background()
	publication := &models.Publication{ID: "publication-1", WorkspaceID: "ws-1", Status: models.PublicationStatusFailed}
	_, err := db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	rendition := &models.Rendition{ID: "rendition-1", PublicationID: publication.ID, Status: models.RenditionStatusReady}
	_, err = db.NewInsert().Model(rendition).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.RenditionMedia{RenditionID: rendition.ID, MediaID: "media-1"}).Exec(ctx)
	require.NoError(t, err)

	usage, err := handler.mediaUsageSummary(ctx, "ws-1", "media-1")
	require.NoError(t, err)
	require.Equal(t, mediaUsageSummary{Total: 1, Blocking: 0}, usage)
}

func TestMediaUsageSummaryCountsVariantMediaAndDedupesByPost(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Post)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
	)
	handler := &MediaHandler{db: db}
	ctx := context.Background()

	posts := []models.Post{
		{ID: "published-post", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "posted", Status: "published"},
		{ID: "draft-post", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "draft", Status: "draft"},
	}
	_, err := db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)

	postMedia := []models.PostMedia{
		{PostID: "published-post", MediaID: "variant-media"},
	}
	_, err = db.NewInsert().Model(&postMedia).Exec(ctx)
	require.NoError(t, err)

	variants := []models.PostVariant{
		{ID: "published-variant", PostID: "published-post", SocialAccountID: "account-1", Content: "posted", MediaIDs: `["variant-media"]`, IsUnsynced: true},
		{ID: "draft-variant", PostID: "draft-post", SocialAccountID: "account-1", Content: "draft", MediaIDs: `["variant-media"]`, IsUnsynced: true},
	}
	_, err = db.NewInsert().Model(&variants).Exec(ctx)
	require.NoError(t, err)

	usage, err := handler.mediaUsageSummary(ctx, "ws-1", "variant-media")
	require.NoError(t, err)
	require.Equal(t, mediaUsageSummary{Total: 2, Blocking: 1}, usage)
}
