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
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type publisherUsageTestServer struct {
	db      *bun.DB
	service *Service
	usage   *usage.Service
	adapter *fakePublisherAdapter
}

func newPublisherUsageTestServer(t *testing.T, adapter *fakePublisherAdapter) *publisherUsageTestServer {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.MediaAttachment)(nil),
		(*models.UsageCounter)(nil),
		(*models.ProviderUsageEvent)(nil),
		(*models.ProviderUsageReservation)(nil),
		(*models.ProviderUsagePeriodCounter)(nil),
		(*models.ProviderWriteAttempt)(nil),
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

	manager := tokenmanager.NewTokenManager(db, encryptor)
	manager.SetProvider("x", adapter)
	usageSvc := usage.NewService(db)
	service := NewService(db, manager)
	service.SetProvider("x", adapter)
	service.SetUsage(usageSvc)
	enableSelfHostedPublisherReadiness(t, db, service, "x", "account-1")

	return &publisherUsageTestServer{db: db, service: service, usage: usageSvc, adapter: adapter}
}

func (s *publisherUsageTestServer) seedPost(t *testing.T, postID string) {
	t.Helper()

	ctx := context.Background()
	_, err := s.db.NewInsert().Model(&models.Post{
		ID:          postID,
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Launch update",
		Status:      models.PostStatusScheduled,
		ScheduledAt: time.Now().UTC(),
		CreatedAt:   time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.PostDestination{
		ID:              "dest-" + postID,
		PostID:          postID,
		SocialAccountID: "account-1",
		Status:          "pending",
	}).Exec(ctx)
	require.NoError(t, err)
}

func (s *publisherUsageTestServer) publishPost(t *testing.T, postID string) error {
	t.Helper()

	payload, err := json.Marshal(map[string]string{"post_id": postID})
	require.NoError(t, err)
	return s.service.HandlePublishJob(context.Background(), string(payload))
}

func (s *publisherUsageTestServer) setQuota(snapshot entitlements.PlanSnapshot) {
	s.service.SetEntitlement(entitlements.NewStaticService(snapshot))
}

func TestPublisherRecordsPublishedPostAndProviderWriteUsage(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-1"}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.seedPost(t, "post-1")

	err := srv.publishPost(t, "post-1")

	require.NoError(t, err)
	require.Equal(t, 1, adapter.publishCalls)
	published, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(1), published)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(1), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-1").Scan(context.Background()))
	require.Equal(t, models.PostStatusPublished, post.Status)
}

func TestPublisherRejectsWhenPublishedPostQuotaExceeded(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-1"}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.setQuota(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitPublishedPostsMonthly: 0,
		},
	})
	srv.seedPost(t, "post-quota")

	err := srv.publishPost(t, "post-quota")

	require.NoError(t, err)
	require.Equal(t, 0, adapter.publishCalls)
	published, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), published)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-quota").Scan(context.Background()))
	require.Equal(t, models.PostStatusFailed, post.Status)
	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destination).Where("post_id = ?", "post-quota").Scan(context.Background()))
	require.Equal(t, FailureBillingRequired, destination.ErrorKind)
	require.False(t, destination.ErrorRetryable)
}

func TestPublisherRejectsWhenProviderWriteQuotaExceeded(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-1"}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.setQuota(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitProviderWriteCallsMonthly: 0,
		},
	})
	srv.seedPost(t, "post-write-quota")

	err := srv.publishPost(t, "post-write-quota")

	require.NoError(t, err)
	require.Equal(t, 0, adapter.publishCalls)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-write-quota").Scan(context.Background()))
	require.Equal(t, models.PostStatusFailed, post.Status)
	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destination).Where("post_id = ?", "post-write-quota").Scan(context.Background()))
	require.Equal(t, FailureBillingRequired, destination.ErrorKind)
	require.False(t, destination.ErrorRetryable)
}

func TestPublisherRecordsProviderWriteUsageOnPublishFailure(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{publishErr: errFakePublishFailed}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.seedPost(t, "post-2")

	err := srv.publishPost(t, "post-2")

	require.NoError(t, err)
	require.Equal(t, 1, adapter.publishCalls)
	published, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), published)
	writes, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitProviderWriteCallsMonthly, time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(1), writes)

	var post models.Post
	require.NoError(t, srv.db.NewSelect().Model(&post).Where("id = ?", "post-2").Scan(context.Background()))
	require.Equal(t, models.PostStatusFailed, post.Status)
	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().Model(&destination).Where("post_id = ?", "post-2").Scan(context.Background()))
	require.Equal(t, FailureUnknown, destination.ErrorKind)
	require.False(t, destination.ErrorRetryable)
}

func TestPublisherRecordsHostedXCostWithoutRetainingPostText(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-cost"}
	srv := newPublisherUsageTestServer(t, adapter)
	require.NoError(t, srv.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(
		1_000_000,
		15_000,
		200_000,
	)))
	srv.seedPost(t, "post-cost")
	_, err := srv.db.NewUpdate().
		Model((*models.Post)(nil)).
		Set("content = ?", "Read openpost.social/launch").
		Where("id = ?", "post-cost").
		Exec(context.Background())
	require.NoError(t, err)

	require.NoError(t, srv.publishPost(t, "post-cost"))

	var event models.ProviderUsageEvent
	require.NoError(t, srv.db.NewSelect().Model(&event).Scan(context.Background()))
	require.Equal(t, usage.ProviderX, event.Provider)
	require.Equal(t, usage.XOperationPostCreateWithURL, event.Operation)
	require.Equal(t, int64(200_000), event.CostMicrousd)
	require.NotContains(t, event.OperationKey, "post-cost")
	require.NotContains(t, event.OperationKey, "openpost.social")
	reservationCount, err := srv.db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, reservationCount)
}

func TestPublisherPricesXURLFromRenderedSettings(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-setting-url"}
	srv := newPublisherUsageTestServer(t, adapter)
	require.NoError(t, srv.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(
		1_000_000,
		15_000,
		200_000,
	)))

	_, err := srv.service.publishProviderWithUsage(
		context.Background(),
		"ws-1",
		usage.ProviderX,
		"rendition-setting-url",
		"publish",
		legacyWriteScope(context.Background(), "ws-1", "account-1", "x", "rendition-setting-url"),
		adapter,
		"access-token",
		"x-account",
		&platform.PublishRequest{
			Content: "Launch update", Profile: models.ContentProfileShortText, OutputProfile: "x.post",
			Settings: map[string]interface{}{"url": "https://openpost.social/launch"},
		},
		nil,
	)

	require.NoError(t, err)
	var event models.ProviderUsageEvent
	require.NoError(t, srv.db.NewSelect().Model(&event).Scan(context.Background()))
	require.Equal(t, usage.XOperationPostCreateWithURL, event.Operation)
	require.Equal(t, int64(200_000), event.CostMicrousd)
}

func TestPublisherAcceptedFenceSurvivesLocalCommitFailureWithoutReplay(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-once"}
	srv := newPublisherUsageTestServer(t, adapter)
	lockedAt := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	ctx := WithJobExecution(context.Background(), "job-provider-once", 1, lockedAt)
	scope := legacyWriteScope(ctx, "ws-1", "account-1", "x", "destination-once")
	request := &platform.PublishRequest{
		Content: "Persist me once", Profile: models.ContentProfileShortText, OutputProfile: "x.post",
	}

	first, err := srv.service.publishProviderWithUsage(
		ctx, "ws-1", usage.ProviderX, "destination-once", "publish",
		scope, adapter, "access-token", "x-account", request, nil,
	)
	require.NoError(t, err)
	require.Equal(t, "external-once", first.ExternalID)

	// Simulate a crash before the caller stores first.ExternalID on its local
	// rendition/destination row by invoking the same logical operation again.
	second, err := srv.service.publishProviderWithUsage(
		ctx, "ws-1", usage.ProviderX, "destination-once", "publish",
		scope, adapter, "access-token", "x-account", request, nil,
	)
	require.NoError(t, err)
	require.Equal(t, first.ExternalID, second.ExternalID)
	require.Equal(t, 1, adapter.publishCalls, "the accepted provider mutation must come from the durable fence")

	var attempts []models.ProviderWriteAttempt
	require.NoError(t, srv.db.NewSelect().Model(&attempts).Where("operation_id = ?", scope.operationID).Scan(ctx))
	require.Len(t, attempts, 1)
	require.Equal(t, "accepted", attempts[0].Status)
}

func TestPublisherAuthorizationFingerprintIgnoresTransientMediaSignatures(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-signed-media"}
	srv := newPublisherUsageTestServer(t, adapter)
	scope := providerWriteScope{
		operationID: "authorization:receipt-1:rendition-1:publish", authorizationID: "receipt-1",
		publicationID: "publication-1", renditionID: "rendition-1",
		socialAccountID: "account-1", targetKey: "x", operation: "publish",
		contentHash: "sha256:content", mediaHash: "sha256:media", settingsHash: "sha256:settings",
	}
	_, err := srv.db.NewInsert().Model(&models.PublicationAuthorization{
		ID: "receipt-1", WorkspaceID: "ws-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", SocialAccountID: "account-1", TargetKey: "x",
		Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyImmediate,
		ProviderPolicyMode: "x.standard", ExecutionIntent: publicationauth.ExecutionIntentProduction,
		ContentHash: scope.contentHash, MediaHash: scope.mediaHash, SettingsHash: scope.settingsHash,
	}).Exec(t.Context())
	require.NoError(t, err)
	media := []models.MediaAttachment{{
		ID: "media-1", FileHash: "sha256:file", MimeType: "image/png", Size: 42,
	}}
	request := func(signature string) *platform.PublishRequest {
		return &platform.PublishRequest{
			Content: "Authorized content", Profile: models.ContentProfileImagePost, OutputProfile: "x.post",
			SettingsJSON:     `{"cover_media_id":"media-1"}`,
			Settings:         map[string]interface{}{"cover_url": "https://app.example/media/media-1?exp=1&sig=" + signature},
			PlatformMediaIDs: []string{"https://app.example/media/media-1?exp=1&sig=" + signature},
		}
	}

	first, err := srv.service.publishProviderWithUsage(
		t.Context(), "ws-1", usage.ProviderX, "rendition-1", "publish",
		scope, adapter, "access-token", "x-account", request("first"), media,
	)
	require.NoError(t, err)
	second, err := srv.service.publishProviderWithUsage(
		t.Context(), "ws-1", usage.ProviderX, "rendition-1", "publish",
		scope, adapter, "access-token", "x-account", request("refreshed"), media,
	)
	require.NoError(t, err)
	require.Equal(t, first.ExternalID, second.ExternalID)
	require.Equal(t, 1, adapter.publishCalls, "refreshing a signed URL must reuse the accepted logical operation")

	changed := request("refreshed")
	changed.Content = "Different content"
	_, err = srv.service.publishProviderWithUsage(
		t.Context(), "ws-1", usage.ProviderX, "rendition-1", "publish",
		scope, adapter, "access-token", "x-account", changed, media,
	)
	require.ErrorIs(t, err, providerwrite.ErrOperationChanged)
}

func TestPublisherDoesNotBillDefiniteXFailure(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{publishErr: &platform.HTTPError{StatusCode: 400, Code: "invalid_request"}}
	srv := newPublisherUsageTestServer(t, adapter)
	require.NoError(t, srv.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(
		1_000_000,
		15_000,
		200_000,
	)))
	srv.seedPost(t, "post-definite-failure")

	require.NoError(t, srv.publishPost(t, "post-definite-failure"))
	require.Equal(t, 1, adapter.publishCalls)

	eventCount, err := srv.db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, eventCount)
	reservationCount, err := srv.db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, reservationCount)
	summary, err := srv.usage.SnapshotProviderCosts(context.Background(), "ws-1", time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), summary[0].CostMicrousd)
	require.Equal(t, int64(0), summary[0].ReservedMicrousd)
}

func TestPublisherKeepsAmbiguousXFailureReservedWithoutBillingIt(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{publishErr: errFakePublishFailed}
	srv := newPublisherUsageTestServer(t, adapter)
	require.NoError(t, srv.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(
		1_000_000,
		15_000,
		200_000,
	)))
	srv.seedPost(t, "post-ambiguous-failure")

	require.NoError(t, srv.publishPost(t, "post-ambiguous-failure"))
	require.Equal(t, 1, adapter.publishCalls)

	eventCount, err := srv.db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, eventCount)
	var reservation models.ProviderUsageReservation
	require.NoError(t, srv.db.NewSelect().Model(&reservation).Scan(context.Background()))
	require.Equal(t, "unknown", reservation.State)
	summary, err := srv.usage.SnapshotProviderCosts(context.Background(), "ws-1", time.Now().UTC())
	require.NoError(t, err)
	require.Equal(t, int64(0), summary[0].CostMicrousd)
	require.Equal(t, int64(15_000), summary[0].ReservedMicrousd)
}

func TestPublisherHostedXBudgetStopsRequestButDisabledPolicyDoesNot(t *testing.T) {
	t.Parallel()

	adapter := &fakePublisherAdapter{externalID: "external-budget"}
	srv := newPublisherUsageTestServer(t, adapter)
	require.NoError(t, srv.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(
		0,
		15_000,
		200_000,
	)))
	srv.seedPost(t, "post-budget")

	require.NoError(t, srv.publishPost(t, "post-budget"))
	require.Equal(t, 0, adapter.publishCalls)

	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().
		Model(&destination).
		Where("post_id = ?", "post-budget").
		Scan(context.Background()))
	require.Equal(t, FailureBillingRequired, destination.ErrorKind)

	require.NoError(t, srv.usage.SetProviderCostPolicy(usage.ProviderCostPolicy{}))
	srv.seedPost(t, "post-selfhost")
	require.NoError(t, srv.publishPost(t, "post-selfhost"))
	require.Equal(t, 1, adapter.publishCalls)
}

func TestPublisherRechecksRuntimeControlImmediatelyBeforeProviderCall(t *testing.T) {
	adapter := &fakePublisherAdapter{externalID: "external-readiness"}
	srv := newPublisherUsageTestServer(t, adapter)
	for _, model := range []interface{}{
		(*models.OAuthGrant)(nil),
		(*models.ProviderApprovalReview)(nil),
		(*models.ProviderCertificationRun)(nil),
		(*models.ProviderCertificationCheck)(nil),
		(*models.ProviderRuntimeControlEvent)(nil),
	} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	_, err := srv.db.NewInsert().Model(&models.OAuthGrant{
		ID: "grant-readiness", WorkspaceID: "ws-1", Provider: capabilities.ProviderX,
		AccessTokenEnc: []byte("encrypted"), ValidationStatus: "valid", ValidatedAt: now.Add(-time.Minute),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("oauth_grant_id = ?", "grant-readiness").
		Where("id = ?", "account-1").Exec(t.Context())
	require.NoError(t, err)

	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.OperatorRuntimeApps(
		[]platform.AppConfig{{Provider: capabilities.ProviderX, ClientID: "x-client"}},
		providerreadiness.ProviderEnvironmentDevelopment,
	))
	require.NoError(t, err)
	repository := providerreadiness.NewRepository(srv.db)
	readiness := providerreadiness.NewService(repository, providerreadiness.ServiceOptions{
		Configurations: catalog, DefaultControl: providerreadiness.RuntimeControlStateEnabled,
	})
	srv.service.SetProviderReadiness(readiness)
	capability, found := capabilities.Find(capabilities.ProviderX, models.ContentProfileShortText)
	require.True(t, found)
	request := &platform.PublishRequest{
		Content: "Readiness", Profile: capability.Profile, OutputProfile: capability.OutputProfile,
	}

	firstScope := legacyWriteScope(t.Context(), "ws-1", "account-1", "x", "readiness-first")
	_, err = srv.service.publishProviderWithUsage(
		t.Context(), "ws-1", capabilities.ProviderX, "readiness-first", "publish",
		firstScope, adapter, "token", "x-account", request, nil,
	)
	require.NoError(t, err)
	require.Equal(t, 1, adapter.publishCalls)

	require.NoError(t, repository.AppendRuntimeControl(t.Context(), providerreadiness.RuntimeControlEvent{
		ID: "control-disable-x", Selector: providerreadiness.RuntimeControlSelector{Provider: capabilities.ProviderX},
		Control:  providerreadiness.RuntimeControl{State: providerreadiness.RuntimeControlStateDisabled, ReasonCode: "operator_kill_switch"},
		StartsAt: now.Add(-time.Second), OperatorRef: "operator:sha256:test", CreatedAt: now,
	}))
	secondScope := legacyWriteScope(t.Context(), "ws-1", "account-1", "x", "readiness-second")
	_, err = srv.service.publishProviderWithUsage(
		t.Context(), "ws-1", capabilities.ProviderX, "readiness-second", "publish",
		secondScope, adapter, "token", "x-account", request, nil,
	)
	var notReady *providerreadiness.NotReadyError
	require.ErrorAs(t, err, &notReady)
	require.Equal(t, providerreadiness.EffectiveStateDisabled, notReady.Decision.State)
	require.Equal(t, 1, adapter.publishCalls, "disabled queued work reached the provider")
}
