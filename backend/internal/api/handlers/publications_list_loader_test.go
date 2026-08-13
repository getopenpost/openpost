package handlers

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type selectQueryCounter struct {
	count atomic.Int64
}

func (counter *selectQueryCounter) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if strings.EqualFold(event.Operation(), "SELECT") {
		counter.count.Add(1)
	}
	return ctx
}

func (*selectQueryCounter) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestLoadPublicationResponsesUsesFixedQueryCount(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Post)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.ProviderDelivery)(nil),
	)
	ctx := context.Background()
	now := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	publications := []models.Publication{
		{
			ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
			Title: "First", Intent: models.PublishingIntentPost,
			ContentProfile: models.ContentProfileShortText, SourceText: "First source",
			SourceContent: "First source", Status: models.PublicationStatusDraft,
			Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "publication-2", WorkspaceID: "workspace-1", CreatedByID: "user-1",
			Title: "Second", Intent: models.PublishingIntentPost,
			ContentProfile: models.ContentProfileShortText, SourceText: "Second source",
			SourceContent: "Second source", Status: models.PublicationStatusDraft,
			Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
		},
	}
	_, err := db.NewInsert().Model(&publications).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	media := []models.MediaAttachment{
		{
			ID: "media-1", WorkspaceID: "workspace-1", FilePath: "media-1.jpg",
			MimeType: "image/jpeg", OriginalFilename: "first.jpg", Size: 100,
		},
		{
			ID: "media-2", WorkspaceID: "workspace-1", FilePath: "media-2.jpg",
			MimeType: "image/jpeg", OriginalFilename: "second.jpg", Size: 200,
		},
	}
	_, err = db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)

	segments := []models.PublicationSegment{
		{ID: "segment-1", PublicationID: "publication-1", Body: "First segment", SettingsJSON: "{}"},
		{ID: "segment-2", PublicationID: "publication-2", Body: "Second segment", SettingsJSON: "{}"},
	}
	_, err = db.NewInsert().Model(&segments).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.PublicationSegmentMedia{
		{SegmentID: "segment-1", MediaID: "media-1", SettingsJSON: "{}"},
		{SegmentID: "segment-2", MediaID: "media-2", SettingsJSON: "{}"},
	}).Exec(ctx)
	require.NoError(t, err)

	renditions := []models.Rendition{
		{
			ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
			TargetKey: "x", Platform: "x", Profile: models.ContentProfileShortText, Body: "First rendition",
			SettingsJSON: "{}", Status: models.RenditionStatusDraft, CreatedAt: now,
		},
		{
			ID: "rendition-2", PublicationID: "publication-2", SocialAccountID: "account-2",
			TargetKey: "mastodon:https://social.example", Platform: "mastodon", Profile: models.ContentProfileShortText, Body: "Second rendition",
			SettingsJSON: "{}", Status: models.RenditionStatusDraft, CreatedAt: now,
		},
	}
	_, err = db.NewInsert().Model(&renditions).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderDelivery{
		ID: "delivery-1", WorkspaceID: "workspace-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", SocialAccountID: "account-1", TargetKey: "x", Provider: "x",
		State: "processing", CurrentAttemptID: "attempt-1", CurrentAttemptNumber: 1,
		CurrentAttemptCreatedAt: now, NextReconciliationAt: now.Add(time.Minute), CreatedAt: now, UpdatedAt: now,
		RetrySafety: "reconcile_only", SafeErrorClass: "provider_processing", SafeErrorCode: "still_processing",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.RenditionMedia{
		{RenditionID: "rendition-1", MediaID: "media-1", Role: "attachment"},
		{RenditionID: "rendition-2", MediaID: "media-2", Role: "attachment"},
	}).Exec(ctx)
	require.NoError(t, err)

	renditionSegments := []models.RenditionSegment{
		{
			ID: "rendition-segment-1", RenditionID: "rendition-1",
			PublicationSegmentID: "segment-1", Body: "First rendition segment",
			SettingsJSON: "{}", Status: models.RenditionStatusDraft,
		},
		{
			ID: "rendition-segment-2", RenditionID: "rendition-2",
			PublicationSegmentID: "segment-2", Body: "Second rendition segment",
			SettingsJSON: "{}", Status: models.RenditionStatusDraft,
		},
	}
	_, err = db.NewInsert().Model(&renditionSegments).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.RenditionSegmentMedia{
		{
			RenditionSegmentID: "rendition-segment-1", MediaID: "media-1",
			Role: "attachment", SettingsJSON: "{}",
		},
		{
			RenditionSegmentID: "rendition-segment-2", MediaID: "media-2",
			Role: "attachment", SettingsJSON: "{}",
		},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Post{
		{
			ID: "post-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
			PublicationID: "publication-1", Content: "First", Status: models.PostStatusDraft,
			Revision: 1, CreatedAt: now,
		},
		{
			ID: "post-2", WorkspaceID: "workspace-1", CreatedByID: "user-1",
			PublicationID: "publication-2", Content: "Second", Status: models.PostStatusDraft,
			Revision: 1, CreatedAt: now,
		},
	}).Exec(ctx)
	require.NoError(t, err)

	counter := &selectQueryCounter{}
	db.AddQueryHook(counter)
	responses, err := (&PublicationHandler{db: db}).loadPublicationResponses(ctx, publications)
	require.NoError(t, err)
	require.Equal(t, int64(8), counter.count.Load())
	require.Len(t, responses, 2)
	require.Equal(t, "post-1", responses[0].TextPostID)
	require.Equal(t, "segment-1", responses[0].Segments[0].ID)
	require.Equal(t, "media-1", responses[0].Segments[0].Media[0].ID)
	require.Equal(t, "rendition-1", responses[0].Renditions[0].ID)
	require.Equal(t, "processing", responses[0].Renditions[0].Delivery.State)
	require.Equal(t, "reconcile", responses[0].Renditions[0].Delivery.RecoveryAction)
	require.Equal(t, "provider_processing", responses[0].Renditions[0].Delivery.ErrorKind)
	require.Equal(t, "still_processing", responses[0].Renditions[0].Delivery.ErrorCode)
	require.Equal(t, "rendition-segment-1", responses[0].Renditions[0].Segments[0].ID)
	require.Equal(t, "media-1", responses[0].Renditions[0].Segments[0].Media[0].ID)
	require.Equal(t, "post-2", responses[1].TextPostID)
	require.Equal(t, "media-2", responses[1].Media[0].ID)

	counter.count.Store(0)
	detail, err := (&PublicationHandler{db: db}).loadPublicationResponse(ctx, "publication-1", "user-1")
	require.NoError(t, err)
	// Workspace authorization includes one constant identity-policy lookup.
	require.Equal(t, int64(11), counter.count.Load())
	require.Equal(t, "publication-1", detail.ID)
	require.Equal(t, "rendition-segment-1", detail.Renditions[0].Segments[0].ID)
}
