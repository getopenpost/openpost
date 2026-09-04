package analytics

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

var analyticsTestSchemaPath string

func TestMain(m *testing.M) {
	templateDir, err := os.MkdirTemp("", "openpost-analytics-tests-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "create analytics test template directory: %v\n", err)
		os.Exit(1)
	}
	analyticsTestSchemaPath = filepath.Join(templateDir, "schema.db")
	db, err := database.InitDB("file:" + analyticsTestSchemaPath + "?mode=rwc")
	if err == nil {
		err = database.CreateSchema(db)
	}
	if db != nil {
		if closeErr := db.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "create analytics test schema: %v\n", err)
		_ = os.RemoveAll(templateDir)
		os.Exit(1)
	}

	code := m.Run()
	if err := os.RemoveAll(templateDir); err != nil && code == 0 {
		fmt.Fprintf(os.Stderr, "remove analytics test template directory: %v\n", err)
		code = 1
	}
	os.Exit(code)
}

func TestOverviewCursorCannotCrossWorkspaceAccountSortSourceRevisionOrSignature(t *testing.T) {
	service := NewService(nil, nil)
	options := normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Source: "all", Sort: "newest", Limit: 1})
	cursor := service.encodeOverviewNextCursor("workspace-a", 0, 1, 2, options, 30, "revision-a", time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC))
	options.AccountID = "account-b"
	options.Cursor = cursor
	_, err := service.decodeOverviewOffset("workspace-a", options, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)

	options = normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Source: "external", Sort: "newest", Limit: 1, Cursor: cursor})
	_, err = service.decodeOverviewOffset("workspace-a", options, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)

	options = normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Source: "all", Sort: "newest", Limit: 1, Cursor: cursor})
	_, err = service.decodeOverviewOffset("workspace-a", options, 30, 2, "revision-b")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)

	_, err = service.decodeOverviewOffset("workspace-b", options, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)
	options.Cursor = cursor[:len(cursor)-1] + "x"
	_, err = service.decodeOverviewOffset("workspace-a", options, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)
}

type staticTokenSource struct{}

func (staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

type failingTokenSource struct {
	calls int32
}

func (f *failingTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	atomic.AddInt32(&f.calls, 1)
	return "", errors.New("expired provider token")
}

type fakeExternalAnalyticsAdapter struct {
	fakeAnalyticsAdapter
	lastAccountToken string
	lastContentToken string
}

func (*fakeExternalAnalyticsAdapter) UsesProviderToken() bool {
	return false
}

func (f *fakeExternalAnalyticsAdapter) FetchAccountAnalytics(_ context.Context, accessToken string, _ platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	f.lastAccountToken = accessToken
	return f.account, f.accountErr
}

func (f *fakeExternalAnalyticsAdapter) FetchContentAnalytics(_ context.Context, accessToken string, _ platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	f.lastContentToken = accessToken
	return f.content, f.contentErr
}

type fakeAnalyticsAdapter struct {
	platform.Adapter
	support      platform.AnalyticsSupport
	account      platform.AnalyticsValues
	content      platform.AnalyticsValues
	accountErr   error
	contentErr   error
	accountCalls int
	contentCalls int
}

type fakeSemanticAnalyticsAdapter struct {
	fakeAnalyticsAdapter
	accountMeasurements platform.AnalyticsMeasurements
	contentMeasurements platform.AnalyticsMeasurements
}

func (f *fakeSemanticAnalyticsAdapter) FetchAccountAnalyticsMeasurements(context.Context, string, platform.AccountAnalyticsRequest) (platform.AnalyticsMeasurements, error) {
	return f.accountMeasurements, f.accountErr
}

func (f *fakeSemanticAnalyticsAdapter) FetchContentAnalyticsMeasurements(context.Context, string, platform.ContentAnalyticsRequest) (platform.AnalyticsMeasurements, error) {
	return f.contentMeasurements, f.contentErr
}

func (f *fakeAnalyticsAdapter) AnalyticsSupport() platform.AnalyticsSupport {
	return f.support
}

func (f *fakeAnalyticsAdapter) FetchAccountAnalytics(context.Context, string, platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	f.accountCalls++
	return f.account, f.accountErr
}

func (f *fakeAnalyticsAdapter) FetchContentAnalytics(context.Context, string, platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	f.contentCalls++
	return f.content, f.contentErr
}

func TestPinterestAnalyticsReadinessFailsClosedBeforeProviderCallAndPreservesHistory(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "pins:read user_accounts:read")
	account.Platform = "pinterest"
	_, err := db.NewUpdate().Model(&account).Column("platform", "granted_scopes").WherePK().Exec(t.Context())
	require.NoError(t, err)
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	existing := &models.AnalyticsSyncState{
		ID: stateID(subjectAccount, account.ID), WorkspaceID: account.WorkspaceID,
		SubjectType: subjectAccount, SubjectID: account.ID, SocialAccountID: account.ID, Platform: account.Platform,
		Status: string(platform.AnalyticsStatusOK), MetricsJSON: `{"impressions":42}`,
		MetricMetadataJSON: `{}`, LastSuccessAt: now.Add(-time.Hour), CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	_, err = db.NewInsert().Model(existing).Exec(t.Context())
	require.NoError(t, err)
	adapter := &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{Account: true, AccountRequiredScopes: []string{"pins:read", "user_accounts:read"}},
		account: platform.AnalyticsValues{platform.MetricImpressions: 99},
	}
	service := NewService(db, staticTokenSource{})
	service.SetProvider("pinterest", adapter)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.now = func() time.Time { return now }

	require.NoError(t, service.syncAccount(t.Context(), account.ID))
	require.Zero(t, adapter.accountCalls, "readiness must be checked before the Pinterest provider call")
	state, err := service.loadState(t.Context(), subjectAccount, account.ID)
	require.NoError(t, err)
	require.Equal(t, "provider_readiness_blocked", state.ErrorCode)
	require.JSONEq(t, `{"impressions":42}`, state.MetricsJSON, "blocking stale or missing certification must not delete stored history")
}

func TestSemanticMeasurementsRoundTripAndIncompatibleMetricsDoNotAggregate(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC)
	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-semantics", now)
	rendition := models.Rendition{
		ID: "rendition-semantics", PublicationID: publication.ID, SocialAccountID: account.ID,
		Platform: account.Platform, Profile: "short_text", Status: models.RenditionStatusPublished,
		ExternalID: "provider-semantics", CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(&rendition).Exec(ctx)
	require.NoError(t, err)

	periodStart := now.Add(-24 * time.Hour)
	periodEnd := now
	scale := int64(100)
	adapter := &fakeSemanticAnalyticsAdapter{
		fakeAnalyticsAdapter: fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true, Content: true}},
		accountMeasurements: platform.AnalyticsMeasurements{
			platform.MetricFollowers: {
				Value: 42,
				AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
					Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationCurrentSnapshot,
				},
			},
		},
		contentMeasurements: platform.AnalyticsMeasurements{
			platform.MetricLikes: {
				Value: 3,
				AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
					Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
				},
			},
			platform.MetricViews: {
				Value: 1250,
				AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
					Unit: platform.AnalyticsMetricUnitMilliseconds, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
					Source: "provider_report", Scale: &scale,
				},
			},
			platform.MetricImpressions: {
				Value: 800,
				AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
					Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationReportingPeriodTotal,
					PeriodStart: &periodStart, PeriodEnd: &periodEnd,
				},
			},
			"completion_rate": {
				Value: 8750,
				AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
					Unit: platform.AnalyticsMetricUnitBasisPoints, Aggregation: platform.AnalyticsMetricAggregationReportingPeriodAverage,
					Source: "provider_report", PeriodStart: &periodStart, PeriodEnd: &periodEnd,
				},
			},
		},
	}
	service := NewService(db, staticTokenSource{})
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("test", adapter)
	service.now = func() time.Time { return now }

	require.NoError(t, service.syncAccount(ctx, account.ID))
	require.NoError(t, service.syncRendition(ctx, rendition.ID))
	var accountState models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&accountState).Where("id = ?", stateID(subjectAccount, account.ID)).Scan(ctx))
	var accountSnapshot models.AnalyticsAccountSnapshot
	require.NoError(t, db.NewSelect().Model(&accountSnapshot).Where("social_account_id = ?", account.ID).Scan(ctx))
	require.JSONEq(t, accountState.MetricsJSON, accountSnapshot.MetricsJSON)
	require.JSONEq(t, accountState.MetricMetadataJSON, accountSnapshot.MetricMetadataJSON)

	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", stateID(subjectRendition, rendition.ID)).Scan(ctx))
	var snapshot models.AnalyticsRenditionSnapshot
	require.NoError(t, db.NewSelect().Model(&snapshot).Where("rendition_id = ?", rendition.ID).Scan(ctx))
	require.JSONEq(t, state.MetricsJSON, snapshot.MetricsJSON)
	require.JSONEq(t, state.MetricMetadataJSON, snapshot.MetricMetadataJSON)

	values, metadata := decodeAnalyticsMetrics(state.MetricsJSON, state.MetricMetadataJSON, platform.AnalyticsMetricSubjectContent, state.Platform)
	require.Equal(t, int64(1250), values[platform.MetricViews])
	require.Equal(t, platform.AnalyticsMetricUnitMilliseconds, metadata[platform.MetricViews].Unit)
	require.Equal(t, "provider_report", metadata[platform.MetricViews].Source)
	require.Equal(t, scale, *metadata[platform.MetricViews].Scale)
	require.Equal(t, platform.AnalyticsMetricUnitBasisPoints, metadata["completion_rate"].Unit)
	require.Equal(t, periodStart, *metadata["completion_rate"].PeriodStart)
	require.Equal(t, periodEnd, *metadata["completion_rate"].PeriodEnd)

	overview, err := service.Overview(ctx, account.WorkspaceID, 30)
	require.NoError(t, err)
	require.Equal(t, int64(42), overview.Summary.Followers.Value)
	require.Equal(t, int64(3), overview.Summary.Engagement.Value)
	require.Zero(t, overview.Summary.Views.Value)
	require.Zero(t, overview.Summary.Views.Measured)
	require.Zero(t, overview.Summary.Impressions.Measured)
	require.Empty(t, overview.Trends.Views)
	require.Equal(t, int64(1250), overview.Content[0].Metrics[platform.MetricViews], "incompatible raw measurements remain inspectable")
	require.Equal(t, platform.AnalyticsMetricUnitMilliseconds, overview.Content[0].MetricMetadata[platform.MetricViews].Unit)
}

func TestProviderFailurePreservesLastSuccessWithoutRetryingQueueJob(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	service := NewService(db, staticTokenSource{})
	service.SetFeatureGate(alwaysEnabledGate{})
	service.now = func() time.Time { return now }
	adapter := &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{Account: true},
		account: platform.AnalyticsValues{platform.MetricFollowers: 42},
	}
	service.SetProvider("test", adapter)

	require.NoError(t, service.syncAccount(ctx, account.ID))
	adapter.accountErr = &platform.AnalyticsError{
		Status:     platform.AnalyticsStatusRateLimited,
		Code:       "rate_limit",
		RetryAfter: 2 * time.Hour,
	}
	now = now.Add(time.Hour)
	require.NoError(t, service.syncAccount(ctx, account.ID))

	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", stateID(subjectAccount, account.ID)).Scan(ctx))
	require.Equal(t, string(platform.AnalyticsStatusRateLimited), state.Status)
	require.JSONEq(t, `{"followers":42}`, state.MetricsJSON)
	require.True(t, now.Add(2*time.Hour).Equal(state.NextSyncAt))
	require.True(t, now.Add(-time.Hour).Equal(state.LastSuccessAt))
}

func acceptedDiscordAttempt(id, operationID string, authorization models.PublicationAuthorization, externalID, reference string, now time.Time) models.ProviderWriteAttempt {
	return models.ProviderWriteAttempt{
		ID: id, OperationID: operationID, AttemptNumber: 1, AuthorizationID: authorization.ID,
		WorkspaceID: authorization.WorkspaceID, PublicationID: authorization.PublicationID,
		RenditionID: authorization.RenditionID, SocialAccountID: authorization.SocialAccountID,
		TargetKey: authorization.TargetKey, Provider: "discord", Operation: "publish",
		PayloadFingerprint: "sha256:payload", Status: "accepted",
		SubmissionState: string(platform.PublishSubmissionAccepted), ProviderState: "discord_message_published",
		ProviderReference: reference, RetrySafety: string(platform.PublishRetryReconcileOnly),
		ExternalID: externalID, CompletedAt: now, CreatedAt: now, UpdatedAt: now,
	}
}

func seedAnalyticsPublication(t *testing.T, db *bun.DB, workspaceID, id string, now time.Time) models.Publication {
	t.Helper()
	publication := models.Publication{
		ID: id, WorkspaceID: workspaceID, CreatedByID: "user-1", Title: "Launch",
		Intent: "post", ContentProfile: "short_text", SourceText: "Launch",
		SourceContent: "Launch", Status: models.PublicationStatusPublished,
		ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	_, err := db.NewInsert().Model(&publication).Exec(context.Background())
	require.NoError(t, err)
	return publication
}

type alwaysEnabledGate struct{}

func (alwaysEnabledGate) IsEffectiveEnabled(context.Context, string, string) (bool, error) {
	return true, nil
}

type disabledGate struct{}

func (disabledGate) IsEffectiveEnabled(context.Context, string, string) (bool, error) {
	return false, nil
}

func jsonStringSlice(t *testing.T, raw any) []string {
	t.Helper()
	values, ok := raw.([]any)
	require.True(t, ok)
	result := make([]string, 0, len(values))
	for _, value := range values {
		text, ok := value.(string)
		require.True(t, ok)
		result = append(result, text)
	}
	return result
}

func newAnalyticsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	template, err := os.ReadFile(analyticsTestSchemaPath)
	require.NoError(t, err)
	databasePath := filepath.Join(t.TempDir(), "analytics.db")
	require.NoError(t, os.WriteFile(databasePath, template, 0o600))
	db, err := database.InitDB("file:" + databasePath + "?mode=rwc")
	require.NoError(t, err)
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Analytics", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Analytics", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func seedAnalyticsAccount(t *testing.T, db *bun.DB, scopes string) models.SocialAccount {
	t.Helper()
	account := models.SocialAccount{
		ID:              "account-1",
		WorkspaceID:     "workspace-1",
		Slug:            "test-account",
		Platform:        "test",
		AccountID:       "provider-account",
		AccountUsername: "person",
		AccessTokenEnc:  []byte("encrypted"),
		GrantedScopes:   scopes,
		IsActive:        true,
		CreatedAt:       time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(&account).Exec(context.Background())
	require.NoError(t, err)
	return account
}
