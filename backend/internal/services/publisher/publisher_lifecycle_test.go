package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestHandlePublishPublicationJobRecordsLifecycleEvents(t *testing.T) {
	t.Parallel()

	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{externalID: "external-1"})

	require.NoError(t, srv.publishPublication(t))

	events := srv.lifecycleEvents(t)
	requireLifecycleTypes(t, events, lifecycle.EventProviderProcessing, lifecycle.EventPublished)
}

func TestHandlePublishPublicationJobRecordsRetryAndFailureEvents(t *testing.T) {
	t.Parallel()

	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{publishErr: &platform.HTTPError{StatusCode: 503, Code: "temporarily_unavailable"}})
	_, err := srv.db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusFailed).
		Set("error_retryable = ?", true).
		Where("id = ?", "rendition-1").
		Exec(context.Background())
	require.NoError(t, err)

	err = srv.publishPublication(t)

	require.Error(t, err)
	events := srv.lifecycleEvents(t)
	requireLifecycleTypes(t, events, lifecycle.EventRetried, lifecycle.EventProviderProcessing, lifecycle.EventFailed)
	require.Contains(t, events[len(events)-1].MetadataJSON, string(FailureProviderServer))
	require.NotContains(t, events[len(events)-1].MetadataJSON, "provider rejected post")
}

func TestSegmentedRenditionRetryResumesWithoutDuplicatingPublishedPrefix(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{
		publishErrors: []error{nil, &platform.HTTPError{StatusCode: 503, Code: "temporarily_unavailable"}, nil},
		externalIDs:   []string{"external-root", "", "external-reply"},
	}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx := context.Background()
	segments := []models.PublicationSegment{
		{ID: "segment-1", PublicationID: "publication-1", Position: 0, Body: "Root", SettingsJSON: "{}"},
		{ID: "segment-2", PublicationID: "publication-1", Position: 1, Body: "Reply", SettingsJSON: "{}"},
	}
	_, err := srv.db.NewInsert().Model(&segments).Exec(ctx)
	require.NoError(t, err)
	renditionSegments := []models.RenditionSegment{
		{ID: "rendition-segment-1", RenditionID: "rendition-1", PublicationSegmentID: "segment-1", Position: 0, Body: "Root", SettingsJSON: "{}", Status: models.RenditionStatusReady},
		{ID: "rendition-segment-2", RenditionID: "rendition-1", PublicationSegmentID: "segment-2", Position: 1, Body: "Reply", SettingsJSON: "{}", Status: models.RenditionStatusReady},
	}
	_, err = srv.db.NewInsert().Model(&renditionSegments).Exec(ctx)
	require.NoError(t, err)

	require.ErrorContains(t, srv.publishPublication(t), "temporarily unavailable")
	var first models.RenditionSegment
	require.NoError(t, srv.db.NewSelect().Model(&first).Where("id = ?", "rendition-segment-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusPublished, first.Status)
	require.Equal(t, "external-root", first.ExternalID)

	require.NoError(t, srv.publishPublication(t))
	require.Equal(t, 3, adapter.publishCalls)
	require.Len(t, adapter.publishRequests, 3)
	require.Equal(t, "", adapter.publishRequests[0].ReplyToID)
	require.Equal(t, "external-root", adapter.publishRequests[1].ReplyToID)
	require.Equal(t, "external-root", adapter.publishRequests[2].ReplyToID)
	require.Equal(t, "Root", adapter.publishRequests[0].Content)
	require.Equal(t, "Reply", adapter.publishRequests[1].Content)
	require.Equal(t, "Reply", adapter.publishRequests[2].Content)

	var second models.RenditionSegment
	require.NoError(t, srv.db.NewSelect().Model(&second).Where("id = ?", "rendition-segment-2").Scan(ctx))
	require.Equal(t, models.RenditionStatusPublished, second.Status)
	require.Equal(t, "external-reply", second.ExternalID)
}

func TestPublicationPartialSuccessKeepsPerDestinationSafeOutcomes(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{
		publishErrors: []error{
			nil,
			&platform.HTTPError{StatusCode: 422, Code: "invalid_media"},
		},
		externalIDs: []string{"external-success", ""},
	}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx := context.Background()
	var firstAccount models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&firstAccount).Where("id = ?", "account-1").Scan(ctx))
	secondAccount := firstAccount
	secondAccount.ID = "account-2"
	secondAccount.AccountID = "x-account-2"
	secondAccount.Slug = "x-account-2"
	require.NoError(t, func() error {
		_, err := srv.db.NewInsert().Model(&secondAccount).Exec(ctx)
		return err
	}())
	require.NoError(t, func() error {
		_, err := srv.db.NewInsert().Model(&models.Rendition{
			ID:              "rendition-2",
			PublicationID:   "publication-1",
			SocialAccountID: "account-2",
			Platform:        "x",
			Profile:         models.ContentProfileShortText,
			Body:            "Second destination",
			Status:          models.RenditionStatusReady,
		}).Exec(ctx)
		return err
	}())
	require.NoError(t, func() error {
		_, err := srv.db.NewInsert().Model(&models.PostDestination{
			ID:              "destination-2",
			PostID:          "post-1",
			SocialAccountID: "account-2",
			Status:          "pending",
		}).Exec(ctx)
		return err
	}())

	require.NoError(t, srv.publishPublication(t))

	var destinations []models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destinations).Order("social_account_id ASC").Scan(ctx))
	require.Len(t, destinations, 2)
	require.Equal(t, "success", destinations[0].Status)
	require.Empty(t, destinations[0].ErrorMessage)
	require.Equal(t, "failed", destinations[1].Status)
	require.Equal(t, FailureValidation, destinations[1].ErrorKind)
	require.Equal(t, "invalid_media", destinations[1].ErrorCode)
	require.False(t, destinations[1].ErrorRetryable)
	require.NotContains(t, destinations[1].ErrorMessage, "Second destination")
}

func TestTextPostPermanentFailureDoesNotRequestAJobRetry(t *testing.T) {
	t.Parallel()

	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{
		publishErr: &platform.HTTPError{StatusCode: 422, Code: "invalid_media"},
	})
	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-1").Scan(t.Context()))

	require.NoError(t, srv.service.publishSinglePost(t.Context(), &post))

	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destination).Where("post_id = ?", post.ID).Scan(t.Context()))
	require.Equal(t, FailureValidation, destination.ErrorKind)
	require.False(t, destination.ErrorRetryable)
}

func TestTextPostTransientFailureStillRetriesWhenAnotherDestinationIsPermanent(t *testing.T) {
	t.Parallel()

	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{
		publishErrors: []error{
			&platform.HTTPError{StatusCode: 503, Code: "temporarily_unavailable"},
			&platform.HTTPError{StatusCode: 422, Code: "invalid_media"},
		},
	})
	ctx := t.Context()
	var firstAccount models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&firstAccount).Where("id = ?", "account-1").Scan(ctx))
	secondAccount := firstAccount
	secondAccount.ID = "account-2"
	secondAccount.AccountID = "x-account-2"
	secondAccount.Slug = "x-account-2"
	_, err := srv.db.NewInsert().Model(&secondAccount).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-2",
		PostID:          "post-1",
		SocialAccountID: secondAccount.ID,
		Status:          "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-1").Scan(ctx))

	err = srv.service.publishSinglePost(ctx, &post)

	var retryable *RetryableError
	require.ErrorAs(t, err, &retryable)
	require.Equal(t, FailureProviderServer, retryable.Failure.Kind)
	var destinations []models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destinations).Order("id ASC").Scan(ctx))
	require.Len(t, destinations, 2)
	require.True(t, destinations[0].ErrorRetryable)
	require.False(t, destinations[1].ErrorRetryable)
}

type publisherLifecycleTestServer struct {
	db      *bun.DB
	service *Service
}

func newPublisherLifecycleTestServer(t *testing.T, adapter *fakePublisherAdapter) *publisherLifecycleTestServer {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.PublicationSegment)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil),
		(*models.MediaAttachment)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.UsageCounter)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})

	encryptor := crypto.NewTokenEncryptor("test-secret-key")
	encAccess, err := encryptor.Encrypt("access-token")
	require.NoError(t, err)

	ctx := context.Background()
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-1",
		WorkspaceID:    "ws-1",
		Platform:       "x",
		AccountID:      "x-account",
		Slug:           "x-account",
		AccessTokenEnc: encAccess,
		IsActive:       true,
		CreatedAt:      time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:             "publication-1",
		WorkspaceID:    "ws-1",
		CreatedByID:    "user-1",
		Title:          "Launch",
		ContentProfile: models.ContentProfileShortText,
		SourceText:     "Launch update",
		SourceContent:  "Launch update",
		Status:         models.PublicationStatusReady,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-1",
		PublicationID:   "publication-1",
		SocialAccountID: "account-1",
		Platform:        "x",
		Profile:         models.ContentProfileShortText,
		Body:            "Launch update",
		Status:          models.RenditionStatusReady,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID:            "post-1",
		WorkspaceID:   "ws-1",
		CreatedByID:   "user-1",
		PublicationID: "publication-1",
		Content:       "Launch update",
		Status:        models.PostStatusScheduled,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-1",
		PostID:          "post-1",
		SocialAccountID: "account-1",
		Status:          "pending",
	}).Exec(ctx)
	require.NoError(t, err)

	manager := tokenmanager.NewTokenManager(db, encryptor)
	manager.SetProvider("x", adapter)
	service := NewService(db, manager)
	service.SetProvider("x", adapter)

	return &publisherLifecycleTestServer{db: db, service: service}
}

func (s *publisherLifecycleTestServer) publishPublication(t *testing.T) error {
	t.Helper()
	payload, err := json.Marshal(map[string]string{"publication_id": "publication-1"})
	require.NoError(t, err)
	return s.service.HandlePublishPublicationJob(context.Background(), string(payload))
}

func (s *publisherLifecycleTestServer) lifecycleEvents(t *testing.T) []models.PublicationLifecycleEvent {
	t.Helper()
	var events []models.PublicationLifecycleEvent
	require.NoError(t, s.db.NewSelect().Model(&events).Order("created_at ASC").Scan(context.Background()))
	return events
}

func requireLifecycleTypes(t *testing.T, events []models.PublicationLifecycleEvent, expected ...string) {
	t.Helper()
	require.Len(t, events, len(expected))
	for i, eventType := range expected {
		require.Equal(t, eventType, events[i].Type)
	}
}
