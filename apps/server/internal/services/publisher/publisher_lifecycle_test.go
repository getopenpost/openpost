package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"

	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

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

func TestSuccessfulFinalPublicationEnqueuesQueueEmptiedReminder(t *testing.T) {
	t.Parallel()

	srv := newPublisherLifecycleTestServer(t, &fakePublisherAdapter{externalID: "external-1"})
	notificationService := notifications.NewService(srv.db, notifications.Options{
		EmailDelivery: publisherTestEmailSender{},
		PublicURL:     "https://app.openpost.test",
	})
	srv.service.SetNotificationService(notificationService)
	_, err := srv.db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
		Status: models.WorkspaceMemberStatusActive,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceActivation{
		ID: "activation:ws-1", WorkspaceID: "ws-1", PublicationID: "publication-1",
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.UserWorkspaceQueueReminder{
		UserID: "user-1", WorkspaceID: "ws-1", QueueEmptiedEnabled: true, RunwayDays: 7,
	}).Exec(t.Context())
	require.NoError(t, err)

	require.NoError(t, srv.publishPublication(t))

	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ?", notifications.JobTypeEmailDelivery).
		Where("payload LIKE ?", "%queue_reminder%").Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

type publisherTestEmailSender struct{}

func (publisherTestEmailSender) DeliverNotificationEmail(context.Context, notifications.EmailMessage) error {
	return nil
}

func (publisherTestEmailSender) DeliverWorkspaceInvitationEmail(context.Context, transactionalmail.WorkspaceInvitationMessage) error {
	return nil
}

func TestPublicationAuthorizationPreflightRejectsChangedContentBeforeProviderCall(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx, payload := srv.authorizedPublicationJob(t)
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

func TestPublicationAuthorizationPreflightRejectsAccountMovedToAnotherWorkspace(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	ctx, payload := srv.authorizedPublicationJob(t)
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("workspace_id = ?", "foreign-workspace").Where("id = ?", "account-1").Exec(t.Context())
	require.NoError(t, err)
	err = srv.service.HandlePublishPublicationJob(ctx, payload)
	require.ErrorIs(t, err, publicationauth.ErrReceiptMismatch)
	require.ErrorContains(t, err, "load authorization account")
	var publication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(t.Context()))
	require.Equal(t, models.PublicationStatusReady, publication.Status)
	require.Zero(t, adapter.publishCalls)
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

	sqldb, err := sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
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
		(*models.Job)(nil),
		(*models.OAuthGrant)(nil),
		(*models.ProviderInstallation)(nil),
		(*models.ProviderAccountBinding)(nil),
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.WorkspaceActivation)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
		(*models.UserWorkspaceQueueReminder)(nil),
		(*models.UserNotificationDigestItem)(nil),
		(*models.UserNotificationMute)(nil),
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
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "Launch"}).Exec(ctx)
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
	ctx, payload := s.authorizedPublicationJob(t)
	return s.service.HandlePublishPublicationJob(ctx, payload)
}

func (s *publisherLifecycleTestServer) authorizedPublicationJob(t *testing.T) (context.Context, string) {
	return s.authorizedPublicationJobWithIntent(t, nil, providerreadiness.ExecutionIntentProduction, publicationauth.Actor{
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
	job := models.Job{ID: s.jobID, Type: "publish_publication", Payload: string(payload), RunAt: s.runAt, Status: "pending"}
	_, err = s.db.NewInsert().Model(&job).On("CONFLICT (id) DO NOTHING").Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model(&job).Set("status='processing'").Set("locked_at=?", time.Now().UTC()).Set("lease_generation=lease_generation+1").WherePK().Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, s.db.NewSelect().Model(&job).WherePK().Scan(ctx))
	return WithJobExecution(ctx, s.jobID, job.Attempts, job.LockedAt, job.LeaseGeneration), string(payload)
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

func TestConfirmedPublicationSurvivesQuotaSettlementFailure(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "confirmed-remote-post"}
	srv := newPublisherLifecycleTestServer(t, adapter)
	_, err := srv.db.NewCreateTable().Model((*models.MonthlyUsageReservation)(nil)).Exec(t.Context())
	require.NoError(t, err)
	srv.service.SetEntitlement(entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "limited", Limits: map[entitlements.LimitKey]int64{entitlements.LimitPublishedPostsMonthly: 1}}))
	_, err = srv.db.ExecContext(t.Context(), `CREATE TRIGGER reject_usage_settlement BEFORE UPDATE OF state ON monthly_usage_reservations WHEN NEW.state = 'committed' BEGIN SELECT RAISE(FAIL, 'usage settlement unavailable'); END`)
	require.NoError(t, err)
	require.NoError(t, srv.publishPublication(t))
	var publication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(t.Context()))
	require.Equal(t, models.PublicationStatusPublished, publication.Status)
	var rendition models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(t.Context()))
	require.Equal(t, models.RenditionStatusPublished, rendition.Status)
	require.Equal(t, "confirmed-remote-post", rendition.ExternalID)
	require.Equal(t, 1, adapter.publishCalls)
	var receipt models.MonthlyUsageReservation
	require.NoError(t, srv.db.NewSelect().Model(&receipt).Scan(t.Context()))
	require.Equal(t, "held", receipt.State, "failed accounting must retain conservative quota exposure")
}
