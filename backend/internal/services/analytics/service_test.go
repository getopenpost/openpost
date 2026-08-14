package analytics

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestOverviewPaginationKeepsAllResultsReachableInStableOrder(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	publications := make([]models.Publication, 0, 121)
	renditions := make([]models.Rendition, 0, 121)
	states := make([]models.AnalyticsSyncState, 0, 122)
	states = append(states, models.AnalyticsSyncState{
		ID: stateID(subjectAccount, account.ID), WorkspaceID: account.WorkspaceID,
		SubjectType: subjectAccount, SubjectID: account.ID, SocialAccountID: account.ID,
		Platform: account.Platform, Status: string(platform.AnalyticsStatusOK),
		MetricsJSON: `{"followers":100}`, LastSuccessAt: now,
	})
	for index := 0; index < 121; index++ {
		publicationID := fmt.Sprintf("publication-%03d", index)
		renditionID := fmt.Sprintf("rendition-%03d", index)
		publishedAt := now.Add(-time.Duration(index) * time.Minute)
		publications = append(publications, models.Publication{
			ID: publicationID, WorkspaceID: account.WorkspaceID, CreatedByID: "user-1",
			Title: publicationID, Intent: "post", ContentProfile: "short_text", SourceContent: publicationID,
			Status: models.PublicationStatusPublished, ActualRunAt: publishedAt, CreatedAt: publishedAt, UpdatedAt: publishedAt,
		})
		renditions = append(renditions, models.Rendition{
			ID: renditionID, PublicationID: publicationID, SocialAccountID: account.ID,
			Platform: account.Platform, Profile: "short_text", Status: models.RenditionStatusPublished,
			ExternalID: renditionID, CreatedAt: publishedAt, UpdatedAt: publishedAt,
		})
		states = append(states, models.AnalyticsSyncState{
			ID: stateID(subjectRendition, renditionID), WorkspaceID: account.WorkspaceID,
			SubjectType: subjectRendition, SubjectID: renditionID, SocialAccountID: account.ID,
			Platform: account.Platform, Status: string(platform.AnalyticsStatusOK),
			MetricsJSON: `{"likes":1,"views":2}`, LastSuccessAt: now,
		})
	}
	_, err := db.NewInsert().Model(&publications).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&renditions).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&states).Exec(ctx)
	require.NoError(t, err)

	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	options := normalizeOverviewOptions(OverviewOptions{Sort: "newest", Limit: 50})
	first, err := service.OverviewWithOptions(ctx, account.WorkspaceID, 30, options)
	require.NoError(t, err)
	require.Len(t, first.Publications, 50)
	require.Equal(t, 121, first.PublicationTotal)
	require.Equal(t, 121, first.ContentTotal)
	require.Equal(t, int64(121), first.Summary.Engagement.Value)
	require.Equal(t, int64(242), first.Summary.Views.Value)
	require.Equal(t, int64(100), first.Summary.Followers.Value)
	require.NotEmpty(t, first.PublicationNextCursor)
	options.Cursor = first.PublicationNextCursor
	second, err := service.OverviewWithOptions(ctx, account.WorkspaceID, 30, options)
	require.NoError(t, err)
	require.Len(t, second.Publications, 50)
	require.NotEqual(t, first.Publications[len(first.Publications)-1].PublicationID, second.Publications[0].PublicationID)
	options.Cursor = second.PublicationNextCursor
	third, err := service.OverviewWithOptions(ctx, account.WorkspaceID, 30, options)
	require.NoError(t, err)
	require.Len(t, third.Publications, 21)
	require.Empty(t, third.PublicationNextCursor)

	seen := map[string]bool{}
	for _, page := range [][]PublicationOverview{first.Publications, second.Publications, third.Publications} {
		for _, publication := range page {
			require.False(t, seen[publication.PublicationID])
			seen[publication.PublicationID] = true
		}
	}
	require.Len(t, seen, 121)
}

func TestOverviewCursorCannotCrossAccountOrSortScope(t *testing.T) {
	options := normalizeOverviewOptions(OverviewOptions{AccountID: "account-a", Sort: "newest", Limit: 1})
	cursor := encodeOverviewNextCursor(0, 1, 2, options, 30)
	options.AccountID = "account-b"
	options.Cursor = cursor
	_, err := decodeOverviewOffset(options, 30, 2)
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)
}

type staticTokenSource struct{}

func (staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

type fakeAnalyticsAdapter struct {
	platform.Adapter
	support    platform.AnalyticsSupport
	account    platform.AnalyticsValues
	content    platform.AnalyticsValues
	accountErr error
	contentErr error
}

func (f *fakeAnalyticsAdapter) AnalyticsSupport() platform.AnalyticsSupport {
	return f.support
}

func (f *fakeAnalyticsAdapter) FetchAccountAnalytics(context.Context, string, platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	return f.account, f.accountErr
}

func (f *fakeAnalyticsAdapter) FetchContentAnalytics(context.Context, string, platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	return f.content, f.contentErr
}

func TestAccountSyncStoresHistoryAndBacksOffWhenUnchanged(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")

	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	service.SetProvider("test", &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{Account: true},
		account: platform.AnalyticsValues{platform.MetricFollowers: 42},
	})

	require.NoError(t, service.syncAccount(ctx, account.ID))
	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", stateID(subjectAccount, account.ID)).Scan(ctx))
	require.Equal(t, string(platform.AnalyticsStatusOK), state.Status)
	require.True(t, now.Add(24*time.Hour).Equal(state.NextSyncAt))
	require.Zero(t, state.UnchangedStreak)

	now = now.Add(24 * time.Hour)
	require.NoError(t, service.syncAccount(ctx, account.ID))
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", stateID(subjectAccount, account.ID)).Scan(ctx))
	require.Equal(t, 1, state.UnchangedStreak)
	require.True(t, now.Add(48*time.Hour).Equal(state.NextSyncAt))

	count, err := db.NewSelect().Model((*models.AnalyticsAccountSnapshot)(nil)).Where("social_account_id = ?", account.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 2, count)

	require.NoError(t, service.recordUnavailable(
		ctx,
		subjectAccount,
		account.ID,
		account,
		platform.AnalyticsStatusPermissionRequired,
		"missing_scope",
		"Reconnect this account.",
	))
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", stateID(subjectAccount, account.ID)).Scan(ctx))
	require.JSONEq(t, `{"followers":42}`, state.MetricsJSON)
	require.False(t, state.LastSuccessAt.IsZero())
	due, err := service.subjectDue(ctx, subjectAccount, account.ID, now)
	require.NoError(t, err)
	require.True(t, due)
}

func TestAccountSyncDeduplicatesSameCaptureWindow(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 7, 26, 10, 0, 30, 0, time.UTC)
	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	service.SetProvider("test", &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{Account: true},
		account: platform.AnalyticsValues{platform.MetricFollowers: 42},
	})

	require.NoError(t, service.syncAccount(ctx, account.ID))
	require.NoError(t, service.syncAccount(ctx, account.ID))
	count, err := db.NewSelect().
		Model((*models.AnalyticsAccountSnapshot)(nil)).
		Where("social_account_id = ?", account.ID).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestRefreshRecordsMissingScopeWithoutCallingProvider(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "basic")
	service := NewService(db, staticTokenSource{})
	service.SetProvider("test", &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{
			Account:               true,
			AccountRequiredScopes: []string{"analytics.read"},
		},
	})

	queued, err := service.RefreshWorkspace(ctx, account.WorkspaceID)
	require.NoError(t, err)
	require.Zero(t, queued)

	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", stateID(subjectAccount, account.ID)).Scan(ctx))
	require.Equal(t, string(platform.AnalyticsStatusPermissionRequired), state.Status)
	require.Contains(t, state.ErrorMessage, "analytics.read")
}

func TestProviderFailurePreservesLastSuccessWithoutRetryingQueueJob(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	service := NewService(db, staticTokenSource{})
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

func TestContentCadenceStopsAutomaticCollectionAfterSevenDays(t *testing.T) {
	require.Equal(t, time.Hour, contentCadence(5*time.Hour))
	require.Equal(t, 3*time.Hour, contentCadence(12*time.Hour))
	require.Equal(t, 12*time.Hour, contentCadence(48*time.Hour))
	require.Equal(t, 24*time.Hour, contentCadence(6*24*time.Hour))
	require.Zero(t, contentCadence(7*24*time.Hour))
}

func TestOverviewAggregatesLatestProviderMetricsWithoutBlendingExposureKinds(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	service.SetProvider("test", &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{Account: true, Content: true},
	})

	publication := &models.Publication{
		ID:             "publication-1",
		WorkspaceID:    account.WorkspaceID,
		CreatedByID:    "user-1",
		Title:          "Launch",
		Intent:         "post",
		ContentProfile: "short_text",
		SourceContent:  "Launch",
		Status:         models.PublicationStatusPublished,
		ActualRunAt:    now.Add(-24 * time.Hour),
		CreatedAt:      now.Add(-48 * time.Hour),
		UpdatedAt:      now.Add(-24 * time.Hour),
	}
	_, err := db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-1",
		PublicationID:   publication.ID,
		SocialAccountID: account.ID,
		Platform:        account.Platform,
		Profile:         "short_text",
		Status:          models.RenditionStatusPublished,
		ExternalID:      "provider-post",
		CreatedAt:       now.Add(-48 * time.Hour),
		UpdatedAt:       now.Add(-24 * time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)
	for _, snapshot := range []models.AnalyticsAccountSnapshot{
		{ID: "snapshot-1", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: account.Platform, MetricsJSON: `{"followers":40}`, CapturedAt: now.Add(-7 * 24 * time.Hour)},
		{ID: "snapshot-2", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: account.Platform, MetricsJSON: `{"followers":50}`, CapturedAt: now},
	} {
		_, err = db.NewInsert().Model(&snapshot).Exec(ctx)
		require.NoError(t, err)
	}
	for _, state := range []models.AnalyticsSyncState{
		{
			ID: stateID(subjectAccount, account.ID), WorkspaceID: account.WorkspaceID,
			SubjectType: subjectAccount, SubjectID: account.ID, SocialAccountID: account.ID,
			Platform: account.Platform, Status: string(platform.AnalyticsStatusOK),
			MetricsJSON: `{"followers":50}`, LastSuccessAt: now,
		},
		{
			ID: stateID(subjectRendition, "rendition-1"), WorkspaceID: account.WorkspaceID,
			SubjectType: subjectRendition, SubjectID: "rendition-1", SocialAccountID: account.ID,
			Platform: account.Platform, Status: string(platform.AnalyticsStatusOK),
			MetricsJSON: `{"likes":5,"comments":2,"views":100,"impressions":300}`, LastSuccessAt: now,
		},
	} {
		_, err = db.NewInsert().Model(&state).Exec(ctx)
		require.NoError(t, err)
	}

	overview, err := service.Overview(ctx, account.WorkspaceID, 30)
	require.NoError(t, err)
	require.Equal(t, 1, overview.Summary.Published)
	require.Equal(t, int64(50), overview.Summary.Followers.Value)
	require.Equal(t, int64(7), overview.Summary.Engagement.Value)
	require.Equal(t, int64(100), overview.Summary.Views.Value)
	require.Equal(t, int64(300), overview.Summary.Impressions.Value)
	require.Len(t, overview.Accounts, 1)
	require.NotNil(t, overview.Accounts[0].FollowerDelta)
	require.Equal(t, int64(10), *overview.Accounts[0].FollowerDelta)
	require.Equal(t, []SeriesPoint{
		{Date: now.Add(-7 * 24 * time.Hour).Format("2006-01-02"), Value: 40},
		{Date: now.Format("2006-01-02"), Value: 50},
	}, overview.FollowerSeries)
	require.Len(t, overview.Content, 1)
	require.Len(t, overview.Publications, 1)
	require.Len(t, overview.Publications[0].Renditions, 1)
	require.Equal(t, int64(7), overview.Publications[0].Engagement)
	require.Equal(t, 1, overview.Publications[0].Measured[platform.MetricViews])
}

func TestOverviewGroupsRenditionsAndOmitsProviderDeletedContent(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	account := seedAnalyticsAccount(t, db, "")
	second := account
	second.ID = "account-2"
	second.AccountID = "provider-account-2"
	second.AccountUsername = "second"
	second.Slug = "test-account-2"
	_, err := db.NewInsert().Model(&second).Exec(ctx)
	require.NoError(t, err)

	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-group", now)
	for _, rendition := range []models.Rendition{
		{
			ID: "rendition-active", PublicationID: publication.ID, SocialAccountID: account.ID,
			Platform: account.Platform, Profile: "short_text", Status: models.RenditionStatusPublished,
			ExternalID: "post-active", CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "rendition-deleted", PublicationID: publication.ID, SocialAccountID: second.ID,
			Platform: second.Platform, Profile: "short_text", Status: models.RenditionStatusPublished,
			ExternalID: "post-deleted", CreatedAt: now, UpdatedAt: now,
		},
	} {
		_, err = db.NewInsert().Model(&rendition).Exec(ctx)
		require.NoError(t, err)
	}
	for _, state := range []models.AnalyticsSyncState{
		{
			ID: stateID(subjectRendition, "rendition-active"), WorkspaceID: account.WorkspaceID,
			SubjectType: subjectRendition, SubjectID: "rendition-active", SocialAccountID: account.ID,
			Platform: account.Platform, Status: string(platform.AnalyticsStatusOK),
			MetricsJSON: `{"likes":3,"views":20}`, LastSuccessAt: now,
		},
		{
			ID: stateID(subjectRendition, "rendition-deleted"), WorkspaceID: account.WorkspaceID,
			SubjectType: subjectRendition, SubjectID: "rendition-deleted", SocialAccountID: second.ID,
			Platform: second.Platform, Status: string(platform.AnalyticsStatusNotFound),
			MetricsJSON: `{"likes":99,"impressions":999}`, LastSuccessAt: now.Add(-time.Hour),
		},
	} {
		_, err = db.NewInsert().Model(&state).Exec(ctx)
		require.NoError(t, err)
	}

	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	overview, err := service.Overview(ctx, account.WorkspaceID, 30)
	require.NoError(t, err)
	require.Len(t, overview.Content, 1)
	require.Len(t, overview.Publications, 1)
	require.Len(t, overview.Publications[0].Renditions, 1)
	require.Equal(t, "rendition-active", overview.Publications[0].Renditions[0].RenditionID)
	require.Equal(t, int64(3), overview.Summary.Engagement.Value)
	require.Equal(t, int64(20), overview.Summary.Views.Value)
	require.Zero(t, overview.Summary.Impressions.Measured)
}

func TestHistoricalRenditionUsesActiveReplacementCredentialsAfterReconnect(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	original := seedAnalyticsAccount(t, db, "")
	_, err := db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", original.ID).
		Exec(ctx)
	require.NoError(t, err)
	replacement := original
	replacement.ID = "account-reconnected"
	replacement.Slug = "test-account-reconnected"
	replacement.IsActive = true
	replacement.CreatedAt = now
	_, err = db.NewInsert().Model(&replacement).Exec(ctx)
	require.NoError(t, err)

	publication := seedAnalyticsPublication(t, db, original.WorkspaceID, "publication-old", now)
	rendition := models.Rendition{
		ID: "rendition-old", PublicationID: publication.ID, SocialAccountID: original.ID,
		Platform: original.Platform, Profile: "short_text", Status: models.RenditionStatusPublished,
		ExternalID: "provider-post", CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(&rendition).Exec(ctx)
	require.NoError(t, err)

	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	service.SetProvider("test", &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{Content: true},
		content: platform.AnalyticsValues{platform.MetricViews: 12},
	})

	queued, err := service.RefreshWorkspace(ctx, original.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	require.NoError(t, service.syncRendition(ctx, rendition.ID))

	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().
		Model(&state).
		Where("id = ?", stateID(subjectRendition, rendition.ID)).
		Scan(ctx))
	require.Equal(t, replacement.ID, state.SocialAccountID)
	require.Equal(t, string(platform.AnalyticsStatusOK), state.Status)
	require.JSONEq(t, `{"views":12}`, state.MetricsJSON)
}

func TestScheduleSweepKeepsOnePendingChainAcrossRestarts(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	service := NewService(db, staticTokenSource{})
	first := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)

	require.NoError(t, service.ScheduleSweep(ctx, first))
	require.NoError(t, service.ScheduleSweep(ctx, first.Add(time.Minute)))

	count, err := db.NewSelect().
		Model((*models.Job)(nil)).
		Where("type = ? AND status = ?", JobTypeSweep, "pending").
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
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

func TestRefreshCountsOnlyNewAnalyticsJobs(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := context.Background()
	account := seedAnalyticsAccount(t, db, "")
	service := NewService(db, staticTokenSource{})
	service.SetProvider("test", &fakeAnalyticsAdapter{
		support: platform.AnalyticsSupport{Account: true},
	})

	queued, err := service.RefreshWorkspace(ctx, account.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, 1, queued)

	queued, err = service.RefreshWorkspace(ctx, account.WorkspaceID)
	require.NoError(t, err)
	require.Zero(t, queued)
}

func newAnalyticsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := database.InitDB("file:" + t.Name() + "?mode=memory&cache=shared")
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
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
