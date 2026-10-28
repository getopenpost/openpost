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
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			db := mediaUsageTestDB(t, backend)
			handler := &MediaHandler{db: db}
			ctx := t.Context()
			publications := []models.Publication{
				{ID: "draft-repeat", WorkspaceID: "ws-1", CreatedByID: "user", Status: models.PublicationStatusDraft},
				{ID: "draft", WorkspaceID: "ws-1", CreatedByID: "user", Status: models.PublicationStatusDraft},
				{ID: "published", WorkspaceID: "ws-1", CreatedByID: "user", Status: " \u2003PUBLISHED\u00a0"},
				{ID: "failed", WorkspaceID: "ws-1", CreatedByID: "user", Status: " FAILED\t"},
				{ID: "unknown", WorkspaceID: "ws-1", CreatedByID: "user", Status: "future-state"},
				{ID: "private", WorkspaceID: "ws-2", CreatedByID: "other-user", Status: models.PublicationStatusDraft},
			}
			_, err := db.NewInsert().Model(&publications).Exec(ctx)
			require.NoError(t, err)
			for _, publication := range publications {
				_, err = db.NewInsert().Model(&models.PublicationSegment{ID: publication.ID, PublicationID: publication.ID}).Exec(ctx)
				require.NoError(t, err)
				_, err = db.NewInsert().Model(&models.Rendition{ID: publication.ID, PublicationID: publication.ID}).Exec(ctx)
				require.NoError(t, err)
				_, err = db.NewInsert().Model(&models.RenditionSegment{
					ID: publication.ID, RenditionID: publication.ID, PublicationSegmentID: publication.ID,
				}).Exec(ctx)
				require.NoError(t, err)
				mediaIDs := []string{"shared"}
				if publication.ID == "published" || publication.ID == "failed" {
					mediaIDs = append(mediaIDs, "completed-only")
				}
				for _, mediaID := range mediaIDs {
					for _, reference := range []any{
						&models.PublicationAsset{PublicationID: publication.ID, MediaID: mediaID},
						&models.PublicationSegmentMedia{SegmentID: publication.ID, MediaID: mediaID},
						&models.RenditionMedia{RenditionID: publication.ID, MediaID: mediaID},
						&models.RenditionSegmentMedia{RenditionSegmentID: publication.ID, MediaID: mediaID},
					} {
						_, err = db.NewInsert().Model(reference).Exec(ctx)
						require.NoError(t, err)
					}
				}
			}
			// One post per reference kind proves each UNION arm contributes on its
			// own; the shared-media posts above only prove deduplication.
			_, err = db.NewInsert().Model(&models.Publication{ID: "asset-only-post", WorkspaceID: "ws-1", CreatedByID: "user", Status: models.PublicationStatusDraft}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.PublicationAsset{PublicationID: "asset-only-post", MediaID: "asset-only"}).Exec(ctx)
			require.NoError(t, err)

			_, err = db.NewInsert().Model(&models.Publication{ID: "segment-only-post", WorkspaceID: "ws-1", CreatedByID: "user", Status: models.PublicationStatusDraft}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.PublicationSegment{ID: "segment-only-segment", PublicationID: "segment-only-post"}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.PublicationSegmentMedia{SegmentID: "segment-only-segment", MediaID: "segment-only"}).Exec(ctx)
			require.NoError(t, err)

			_, err = db.NewInsert().Model(&models.Publication{ID: "rendition-only-post", WorkspaceID: "ws-1", CreatedByID: "user", Status: models.PublicationStatusDraft}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.Rendition{ID: "rendition-only-rendition", PublicationID: "rendition-only-post"}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.RenditionMedia{RenditionID: "rendition-only-rendition", MediaID: "rendition-only"}).Exec(ctx)
			require.NoError(t, err)

			_, err = db.NewInsert().Model(&models.Publication{ID: "rendition-segment-only-post", WorkspaceID: "ws-1", CreatedByID: "user", Status: models.PublicationStatusDraft}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.PublicationSegment{ID: "rendition-segment-only-source", PublicationID: "rendition-segment-only-post"}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.Rendition{ID: "rendition-segment-only-rendition", PublicationID: "rendition-segment-only-post"}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.RenditionSegment{ID: "rendition-segment-only-segment", RenditionID: "rendition-segment-only-rendition", PublicationSegmentID: "rendition-segment-only-source"}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.RenditionSegmentMedia{RenditionSegmentID: "rendition-segment-only-segment", MediaID: "rendition-segment-only"}).Exec(ctx)
			require.NoError(t, err)

			usage, err := handler.mediaUsageSummaries(ctx, "ws-1", []string{"shared", "completed-only", "unused", "asset-only", "segment-only", "rendition-only", "rendition-segment-only"})
			require.NoError(t, err)
			require.Equal(t, map[string]mediaUsageSummary{
				"shared":                 {Total: 5, Blocking: 3},
				"completed-only":         {Total: 2},
				"unused":                 {},
				"asset-only":             {Total: 1, Blocking: 1},
				"segment-only":           {Total: 1, Blocking: 1},
				"rendition-only":         {Total: 1, Blocking: 1},
				"rendition-segment-only": {Total: 1, Blocking: 1},
			}, usage)
		})
	}
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
