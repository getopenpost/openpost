package handlers

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

type failingDeleteStorage struct{}

func (failingDeleteStorage) Driver() string                         { return "test" }
func (failingDeleteStorage) Save(string, io.Reader) (string, error) { return "", nil }
func (failingDeleteStorage) Delete(string) error                    { return errors.New("storage unavailable") }
func (failingDeleteStorage) GetURL(string) string                   { return "" }
func (failingDeleteStorage) Open(string) (io.ReadCloser, error)     { return nil, errors.New("not found") }

func TestMediaUsageSummaryAllowsOnlyPublishedUsage(t *testing.T) {
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
	require.Equal(t, mediaUsageSummary{Total: 1, Blocking: 1}, usage)
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

func TestDeleteMediaCommitsDatabaseRemovalBeforeBestEffortBlobCleanup(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Post)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.RenditionMedia)(nil),
		(*models.MediaAttachment)(nil),
	)
	handler := &MediaHandler{db: db, storage: failingDeleteStorage{}}
	ctx := context.Background()
	media := &models.MediaAttachment{
		ID:          "media-delete",
		WorkspaceID: "ws-1",
		FilePath:    "media-delete.jpg",
		MimeType:    "image/jpeg",
	}
	_, err := db.NewInsert().Model(media).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, handler.deleteMedia(ctx, media))

	count, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", media.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}
