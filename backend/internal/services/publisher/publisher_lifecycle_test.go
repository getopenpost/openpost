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
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
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

func TestHandlePublishPublicationJobRecordsAmbiguousFailureWithoutRetry(t *testing.T) {
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
	require.Contains(t, events[len(events)-1].MetadataJSON, string(FailureUnknown))
	require.Contains(t, events[len(events)-1].MetadataJSON, "ambiguous_provider_write")
	require.Contains(t, events[len(events)-1].MetadataJSON, `"retryable":false`)
	require.NotContains(t, events[len(events)-1].MetadataJSON, "provider rejected post")
}

func TestSegmentedRenditionRetryResumesWithoutDuplicatingPublishedPrefix(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{
		preFenceErrors: []error{nil, &platform.HTTPError{StatusCode: 503, Code: "temporarily_unavailable"}, nil},
		externalIDs:    []string{"external-root", "", "external-reply"},
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
	require.Len(t, adapter.publishRequests, 2)
	require.Equal(t, "", adapter.publishRequests[0].ReplyToID)
	require.Equal(t, "external-root", adapter.publishRequests[1].ReplyToID)
	require.Equal(t, "Root", adapter.publishRequests[0].Content)
	require.Equal(t, "Reply", adapter.publishRequests[1].Content)

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

func TestPublicationAuthorizationPreflightRejectsChangedContentBeforeProviderCall(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx, payload := srv.authorizedPublicationJob(t, nil)
	_, err := srv.db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("body = ?", "changed after confirmation").Where("id = ?", "rendition-1").Exec(t.Context())
	require.NoError(t, err)

	err = srv.service.HandlePublishPublicationJob(ctx, payload)

	require.ErrorContains(t, err, "receipt no longer matches")
	require.Zero(t, adapter.publishCalls)
	var publication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(t.Context()))
	require.Equal(t, models.PublicationStatusReady, publication.Status, "preflight must run before publishing state changes")
}

func TestPublicationAuthorizationPreflightFailureDoesNotLeaveScheduledPublicationPending(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx, payload := srv.authorizedPublicationJob(t, nil)
	_, err := srv.db.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusScheduled).
		Where("id = ?", "publication-1").Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Where("id = ?", "rendition-1").Exec(t.Context())
	require.NoError(t, err)

	var body map[string]string
	require.NoError(t, json.Unmarshal([]byte(payload), &body))
	body["authorization_scheduled_at"] = srv.runAt.Add(time.Second).Format(time.RFC3339Nano)
	tampered, err := json.Marshal(body)
	require.NoError(t, err)

	err = srv.service.HandlePublishPublicationJob(ctx, string(tampered))

	require.ErrorContains(t, err, "scheduled time mismatch")
	require.Zero(t, adapter.publishCalls)
	var publication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(t.Context()))
	require.Equal(t, models.PublicationStatusFailed, publication.Status)
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusFailed, rendition.Status)
	require.Equal(t, FailureValidation, rendition.ErrorKind)
	require.Equal(t, FailureActionEdit, rendition.ErrorAction)
	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-1").Scan(t.Context()))
	require.Equal(t, models.PostStatusFailed, post.Status)
	requireLifecycleTypes(t, srv.lifecycleEvents(t), lifecycle.EventFailed)
}

func TestPublicationAuthorizationPreflightUsesReceiptDestinationAllowlist(t *testing.T) {
	adapter := &fakePublisherAdapter{externalIDs: []string{"external-1"}}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx := t.Context()
	var account models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "account-1").Scan(ctx))
	account.ID, account.Slug, account.AccountID = "account-2", "account-2", "account-2"
	_, err := srv.db.NewInsert().Model(&account).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-2", PublicationID: "publication-1", SocialAccountID: "account-2",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "not authorized",
		Status: models.RenditionStatusReady,
	}).Exec(ctx)
	require.NoError(t, err)

	jobCtx, payload := srv.authorizedPublicationJob(t, []publicationauth.JobTarget{{
		JobID: srv.jobID, RenditionID: "rendition-1", RunAt: srv.runAt,
	}})
	require.NoError(t, srv.service.HandlePublishPublicationJob(jobCtx, payload))
	require.Equal(t, 1, adapter.publishCalls)
	var second models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&second).Where("id = ?", "rendition-2").Scan(ctx))
	require.Equal(t, models.RenditionStatusReady, second.Status)
}

func TestLegacyPublicationJobAuthorizationRunsThroughPublisherPreflight(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "external-legacy"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	job := models.Job{
		ID: srv.jobID, Type: "publish_publication",
		ScopeID: "publication-1", Payload: `{"publication_id":"publication-1"}`,
		Status: "pending", RunAt: srv.runAt,
	}
	_, err := srv.db.NewInsert().Model(&job).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, publicationauth.AuthorizeLegacyJobs(t.Context(), srv.db, publicationauth.LegacyJobsInput{
		PublicationID: "publication-1",
		Actor:         publicationauth.Actor{Origin: publicationauth.OriginLegacy, UserID: "user-1"},
	}))
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("id = ?", job.ID).Scan(t.Context()))

	err = srv.service.HandlePublishPublicationJob(
		WithJobExecution(t.Context(), job.ID, 1, time.Now().UTC()),
		job.Payload,
	)
	require.NoError(t, err)
	require.Equal(t, 1, adapter.publishCalls)
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
		preFenceErrors: []error{
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
	jobID   string
	batchID string
	runAt   time.Time
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
		(*models.PublicationAuthorization)(nil),
		(*models.ProviderApprovalReview)(nil),
		(*models.ProviderCertificationRun)(nil),
		(*models.ProviderCertificationCheck)(nil),
		(*models.ProviderRuntimeControlEvent)(nil),
		(*models.ProviderWriteAttempt)(nil),
		(*models.UsageCounter)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.Job)(nil),
		(*models.OAuthGrant)(nil),
		(*models.User)(nil),
		(*models.APIToken)(nil),
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
	_, err = db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "admin@example.test", Username: "admin", IsAdmin: true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OAuthGrant{
		ID: "grant-1", WorkspaceID: "ws-1", Provider: "x", AccessTokenEnc: encAccess,
		ValidationStatus: "valid", ValidatedAt: time.Now().UTC().Add(-time.Minute),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-1",
		WorkspaceID:    "ws-1",
		Platform:       "x",
		AccountID:      "x-account",
		Slug:           "x-account",
		AccessTokenEnc: encAccess,
		OAuthGrantID:   "grant-1",
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
	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps(
		[]platform.AppConfig{{
			Provider: "x", ClientID: "x-client",
			RedirectURI: "https://openpost.test/api/v1/accounts/x/callback",
		}},
		providerreadiness.ConfigurationSourceEnvironment,
		providerreadiness.ProviderEnvironmentDevelopment,
	))
	require.NoError(t, err)
	service.SetProviderReadiness(providerreadiness.NewService(
		providerreadiness.NewRepository(db),
		providerreadiness.ServiceOptions{
			Configurations: catalog, DefaultControl: providerreadiness.RuntimeControlStateEnabled,
		},
	))

	return &publisherLifecycleTestServer{
		db: db, service: service, jobID: uuid.NewString(), batchID: uuid.NewString(),
		runAt: time.Now().UTC().Add(time.Minute).Truncate(time.Microsecond),
	}
}

func (s *publisherLifecycleTestServer) publishPublication(t *testing.T) error {
	t.Helper()
	ctx, payload := s.authorizedPublicationJob(t, nil)
	return s.service.HandlePublishPublicationJob(ctx, payload)
}

func (s *publisherLifecycleTestServer) authorizedPublicationJob(t *testing.T, targets []publicationauth.JobTarget) (context.Context, string) {
	return s.authorizedPublicationJobWithIntent(t, targets, providerreadiness.ExecutionIntentProduction, publicationauth.Actor{
		Origin: publicationauth.OriginLegacy, UserID: "user-1",
	})
}

func (s *publisherLifecycleTestServer) authorizedPublicationJobWithIntent(
	t *testing.T,
	targets []publicationauth.JobTarget,
	intent providerreadiness.ExecutionIntent,
	actor publicationauth.Actor,
) (context.Context, string) {
	t.Helper()
	ctx := t.Context()
	count, err := s.db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("batch_id = ?", s.batchID).Count(ctx)
	require.NoError(t, err)
	if count == 0 {
		if len(targets) == 0 {
			targets = []publicationauth.JobTarget{{JobID: s.jobID, RunAt: s.runAt}}
		}
		_, _, err = publicationauth.CreateBatch(ctx, s.db, publicationauth.BatchInput{
			BatchID: s.batchID, PublicationID: "publication-1",
			Actor:  actor,
			Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyScheduled,
			ExecutionIntent: string(intent), Targets: targets,
		})
		require.NoError(t, err)
	}
	payload, err := json.Marshal(map[string]string{
		"publication_id": "publication-1", "authorization_batch_id": s.batchID,
		"authorization_scheduled_at": s.runAt.Format(time.RFC3339Nano),
		"readiness_intent":           string(intent),
	})
	require.NoError(t, err)
	return WithJobExecution(ctx, s.jobID, 1, time.Now().UTC()), string(payload)
}

func TestCertificationIntentJobPayloadCannotEscalateProductionReceipt(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx, payload := srv.authorizedPublicationJob(t, nil)
	var body map[string]string
	require.NoError(t, json.Unmarshal([]byte(payload), &body))
	body["readiness_intent"] = string(providerreadiness.ExecutionIntentCertificationTest)
	tampered, err := json.Marshal(body)
	require.NoError(t, err)

	err = srv.service.HandlePublishPublicationJob(ctx, string(tampered))
	require.Error(t, err)
	require.Zero(t, adapter.publishCalls)
}

func TestCertificationIntentRechecksAdministratorAtWorkerTime(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx, payload := srv.authorizedPublicationJobWithIntent(
		t, nil, providerreadiness.ExecutionIntentCertificationTest,
		publicationauth.Actor{Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-1"},
	)
	_, err := srv.db.NewUpdate().Model((*models.User)(nil)).Set("is_admin = ?", false).Where("id = ?", "user-1").Exec(t.Context())
	require.NoError(t, err)

	err = srv.service.HandlePublishPublicationJob(ctx, payload)
	require.ErrorContains(t, err, "no longer authorized")
	require.Zero(t, adapter.publishCalls)
}

func TestCertificationIntentRejectsLegacyActorReceipt(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx, payload := srv.authorizedPublicationJobWithIntent(
		t, nil, providerreadiness.ExecutionIntentCertificationTest,
		publicationauth.Actor{Origin: publicationauth.OriginLegacy, UserID: "user-1"},
	)

	err := srv.service.HandlePublishPublicationJob(ctx, payload)
	require.ErrorContains(t, err, "actor origin is not privileged")
	require.Zero(t, adapter.publishCalls)
}

func (s *publisherLifecycleTestServer) lifecycleEvents(t *testing.T) []models.PublicationLifecycleEvent {
	t.Helper()
	var events []models.PublicationLifecycleEvent
	require.NoError(t, s.db.NewSelect().Model(&events).
		Where("type != ?", lifecycle.EventAuthorizationConfirmed).
		Order("created_at ASC").Scan(context.Background()))
	return events
}

func requireLifecycleTypes(t *testing.T, events []models.PublicationLifecycleEvent, expected ...string) {
	t.Helper()
	require.Len(t, events, len(expected))
	for i, eventType := range expected {
		require.Equal(t, eventType, events[i].Type)
	}
}
