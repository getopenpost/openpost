package analytics

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestOverviewCursorCannotCrossWorkspaceAccountSortRevisionOrSignature(t *testing.T) {
	t.Parallel()
	service := NewService(nil, nil)
	options := normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Sort: "newest", Limit: 1})
	cursor := service.encodeOverviewNextCursor("workspace-a", 0, 1, 2, options, 30, "revision-a", time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC))

	// Control: an unchanged subject still decodes to its encoded offset.
	unchanged := normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Sort: "newest", Limit: 1, Cursor: cursor})
	offset, err := service.decodeOverviewOffset("workspace-a", unchanged, 30, 2, "revision-a")
	require.NoError(t, err)
	require.Equal(t, 1, offset)

	options.AccountID = "account-b"
	options.Cursor = cursor
	_, err = service.decodeOverviewOffset("workspace-a", options, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)

	options = normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Sort: "newest", Limit: 1, Cursor: cursor})
	_, err = service.decodeOverviewOffset("workspace-a", options, 30, 2, "revision-b")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)

	_, err = service.decodeOverviewOffset("workspace-b", options, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)

	// Sort is part of the bound subject too: the same page must not be replayed
	// against a different ordering.
	resorted := normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Sort: "views", Limit: 1, Cursor: cursor})
	_, err = service.decodeOverviewOffset("workspace-a", resorted, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)

	options.Cursor = cursor[:len(cursor)-1] + "x"
	_, err = service.decodeOverviewOffset("workspace-a", options, 30, 2, "revision-a")
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)
}

type staticTokenSource struct{}

func (staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

type fakeAnalyticsAdapter struct {
	platform.Adapter
	support        platform.AnalyticsSupport
	account        platform.AnalyticsValues
	content        platform.AnalyticsValues
	accountErr     error
	contentErr     error
	accountCalls   int
	contentCalls   int
	onAccountFetch func()
}

func (f *fakeAnalyticsAdapter) AnalyticsSupport() platform.AnalyticsSupport {
	return f.support
}

func (f *fakeAnalyticsAdapter) FetchAccountAnalytics(context.Context, string, platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	f.accountCalls++
	if f.onAccountFetch != nil {
		f.onAccountFetch()
	}
	return f.account, f.accountErr
}

func (f *fakeAnalyticsAdapter) FetchContentAnalytics(context.Context, string, platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	f.contentCalls++
	return f.content, f.contentErr
}

func TestPinterestAnalyticsReadinessFailsClosedBeforeProviderCallAndPreservesHistory(t *testing.T) {
	t.Parallel()
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

func newAnalyticsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	db := testdb.NewSQLite(t)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Analytics", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Analytics", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
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

func TestXAnalyticsUsesDailyCadenceAndDoesNotRepeatForcedReads(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	account.Platform = "x"
	_, err := db.NewUpdate().Model(&account).Column("platform").WherePK().Exec(t.Context())
	require.NoError(t, err)
	// Match the microsecond precision preserved by the database.
	now := time.Date(2026, time.October, 10, 9, 30, 0, 123456000, time.UTC)
	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "x-publication", now)
	rendition := &models.Rendition{ID: "x-rendition", PublicationID: publication.ID, SocialAccountID: account.ID, Platform: "x", TargetKey: "x", Status: models.RenditionStatusPublished, ExternalID: "123", CreatedAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(rendition).Exec(t.Context())
	require.NoError(t, err)
	adapter := &fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true, Content: true}, content: platform.AnalyticsValues{platform.MetricLikes: 3}}
	service := NewService(db, staticTokenSource{})
	service.SetProvider("x", adapter)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.now = func() time.Time { return now }
	require.NoError(t, service.syncRendition(t.Context(), rendition.ID))
	state, err := service.loadState(t.Context(), subjectRendition, rendition.ID)
	require.NoError(t, err)
	require.True(t, now.Add(24*time.Hour).Equal(state.NextSyncAt), "stored next sync %s, expected %s", state.NextSyncAt.Format(time.RFC3339Nano), now.Add(24*time.Hour).Format(time.RFC3339Nano))
	require.NoError(t, service.syncRendition(t.Context(), rendition.ID))
	require.Equal(t, 1, adapter.contentCalls)
}

func TestXAnalyticsReservesReadBudgetBeforeProviderRequest(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	account.Platform = "x"
	_, err := db.NewUpdate().Model(&account).Column("platform").WherePK().Exec(t.Context())
	require.NoError(t, err)
	meter := usage.NewService(db)
	require.NoError(t, meter.SetProviderCostPolicy(usage.NewXProviderCostPolicy(10_000, 15_000, 200_000)))
	adapter := &fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true}, account: platform.AnalyticsValues{platform.MetricFollowers: 5}}
	// The reservation must already be durable when the provider request starts,
	// so an accepted read can never be unbilled.
	reservedBeforeFetch := false
	adapter.onAccountFetch = func() {
		var reservations []models.ProviderUsageReservation
		require.NoError(t, db.NewSelect().Model(&reservations).Where("workspace_id = ?", account.WorkspaceID).Scan(t.Context()))
		require.Len(t, reservations, 1, "read exposure must be reserved before the provider request")
		require.Equal(t, usage.ProviderX, reservations[0].Provider)
		require.Equal(t, usage.XOperationUserRead, reservations[0].Operation)
		require.EqualValues(t, 1, reservations[0].Units)
		require.EqualValues(t, 10_000, reservations[0].CostMicrousd)
		require.Equal(t, "pending", reservations[0].State, "the exposure must still be reserved, not yet confirmed")
		require.NotEmpty(t, reservations[0].OperationKey)
		reservedBeforeFetch = true
	}
	service := NewService(db, staticTokenSource{})
	service.SetProvider("x", adapter)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetUsage(meter)
	// Pin the clock mid-month: the X budget window is the calendar month of the
	// event time, and the retry below adds 25 hours. A real-clock start on the
	// last day of a month would cross into the next budget period and make the
	// budget-exhaustion assertion date-dependent.
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	require.NoError(t, service.syncAccount(t.Context(), account.ID))
	require.True(t, reservedBeforeFetch, "the provider request must observe the reservation")
	require.Equal(t, 1, adapter.accountCalls)
	var events []models.ProviderUsageEvent
	require.NoError(t, db.NewSelect().Model(&events).Scan(t.Context()))
	require.Len(t, events, 1)
	require.Equal(t, "user_read", events[0].Operation)
	require.EqualValues(t, 10_000, events[0].CostMicrousd)
	now = now.Add(25 * time.Hour)
	require.NoError(t, service.syncAccount(t.Context(), account.ID))
	require.Equal(t, 1, adapter.accountCalls, "budget exhaustion must prevent I/O")
	state, err := service.loadState(t.Context(), subjectAccount, account.ID)
	require.NoError(t, err)
	require.Equal(t, "provider_budget_exceeded", state.ErrorCode)
}

func TestResolveRepurposeSourceRejectsInvalidAndCrossWorkspaceSources(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Now().UTC()
	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-1", now)
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, TargetKey: "post",
		SocialAccountID: account.ID, Platform: account.Platform, Profile: "short_text",
		Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(&rendition).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})

	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "external", PublicationID: publication.ID, RenditionID: rendition.ID}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrInvalidRepurposeReference)
	_, err = service.ResolveRepurposeSource(t.Context(), account.WorkspaceID, ContentReference{Type: "openpost"}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrInvalidRepurposeReference)
	_, err = service.ResolveRepurposeSource(t.Context(), "another-workspace", ContentReference{Type: "openpost", PublicationID: publication.ID, RenditionID: rendition.ID}, RepurposeRange{Days: 30})
	require.ErrorIs(t, err, ErrRepurposeSourceNotFound)
}

func insightTestContent(id, accountID, provider string, publishedAt time.Time, engagement int64, metadata map[string]platform.AnalyticsMetricMetadata) ContentOverview {
	reference := ContentReference{Type: string(platform.AccountContentOriginOpenPost), PublicationID: "publication-" + id, RenditionID: id}
	metrics := platform.AnalyticsValues{}
	if metadata != nil {
		metrics[platform.MetricLikes] = engagement
	}
	return ContentOverview{
		Reference: reference, Title: id, Excerpt: id, Platform: provider,
		AccountID: accountID, Username: accountID, PublishedAt: publishedAt, CollectedAt: publishedAt.Add(time.Hour),
		Metrics: metrics, MetricMetadata: metadata,
	}
}
