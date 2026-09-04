package handlers

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestMediaUsageSummaryUsesCanonicalPublicationReferences(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.PublicationAsset)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
	)
	handler := &MediaHandler{db: db}
	ctx := context.Background()

	publications := []models.Publication{
		{ID: "published-publication", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusPublished},
		{ID: "scheduled-publication", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusScheduled},
		{ID: "failed-publication", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusFailed},
	}
	_, err := db.NewInsert().Model(&publications).Exec(ctx)
	require.NoError(t, err)
	segments := []models.PublicationSegment{
		{ID: "published-segment", PublicationID: "published-publication"},
		{ID: "scheduled-segment", PublicationID: "scheduled-publication"},
		{ID: "failed-segment", PublicationID: "failed-publication"},
	}
	_, err = db.NewInsert().Model(&segments).Exec(ctx)
	require.NoError(t, err)
	segmentMedia := []models.PublicationSegmentMedia{
		{SegmentID: "published-segment", MediaID: "published-media"},
		{SegmentID: "scheduled-segment", MediaID: "blocked-media"},
		{SegmentID: "failed-segment", MediaID: "failed-media"},
	}
	_, err = db.NewInsert().Model(&segmentMedia).Exec(ctx)
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

func TestMediaUsageSummaryCountsOnePublicationAcrossReferenceKinds(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.PublicationAsset)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
	)
	handler := &MediaHandler{db: db}
	ctx := context.Background()

	_, err := db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusReady,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationAsset{PublicationID: "publication-1", MediaID: "media-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationSegment{ID: "segment-1", PublicationID: "publication-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationSegmentMedia{SegmentID: "segment-1", MediaID: "media-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{ID: "rendition-1", PublicationID: "publication-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.RenditionMedia{RenditionID: "rendition-1", MediaID: "media-1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.RenditionSegment{
		ID: "rendition-segment-1", RenditionID: "rendition-1", PublicationSegmentID: "segment-1",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.RenditionSegmentMedia{
		RenditionSegmentID: "rendition-segment-1", MediaID: "media-1",
	}).Exec(ctx)
	require.NoError(t, err)

	usage, err := handler.mediaUsageSummary(ctx, "ws-1", "media-1")
	require.NoError(t, err)
	require.Equal(t, mediaUsageSummary{Total: 1, Blocking: 1}, usage)
}

func TestMediaUsageStatusBlocksOnlyActiveWork(t *testing.T) {
	t.Parallel()

	for _, status := range []string{
		models.PublicationStatusDraft,
		models.PublicationStatusReady,
		models.PublicationStatusScheduled,
		models.PublicationStatusPublishing,
	} {
		require.True(t, mediaUsageStatusBlocks(status), status)
	}
	for _, status := range []string{models.PublicationStatusPublished, models.PublicationStatusFailed} {
		require.False(t, mediaUsageStatusBlocks(status), status)
	}
}
