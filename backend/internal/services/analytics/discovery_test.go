package analytics

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type fakeAccountContentDiscoverer struct {
	platform.Adapter
	support  platform.AccountContentDiscoverySupport
	discover func(context.Context, string, platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error)
}

func (f *fakeAccountContentDiscoverer) AccountContentDiscoverySupport(platform.AnalyticsAccountContext) platform.AccountContentDiscoverySupport {
	return f.support
}

func (f *fakeAccountContentDiscoverer) DiscoverAccountContent(ctx context.Context, token string, request platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
	return f.discover(ctx, token, request)
}

type fakeBatchAccountContentDiscoverer struct {
	*fakeAccountContentDiscoverer
	measure func(context.Context, string, platform.AccountContentBatchMeasurementRequest) (platform.AccountContentBatchMeasurements, error)
}

func (f *fakeBatchAccountContentDiscoverer) FetchAccountContentBatchMeasurements(ctx context.Context, token string, request platform.AccountContentBatchMeasurementRequest) (platform.AccountContentBatchMeasurements, error) {
	return f.measure(ctx, token, request)
}

func TestDiscoveryLinksExactRenditionOnceAndKeepsExternalUploadsPublicationFree(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "content.read")
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	publication := models.Publication{
		ID: "publication-managed", WorkspaceID: account.WorkspaceID, CreatedByID: "user-1",
		Title: "Managed", Intent: "post", ContentProfile: models.ContentProfileLongVideo,
		SourceContent: "Managed", Status: models.PublicationStatusPublished, ActualRunAt: now.Add(-time.Hour),
		CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	require.NoError(t, func() error { _, err := db.NewInsert().Model(&publication).Exec(t.Context()); return err }())
	rendition := models.Rendition{
		ID: "rendition-managed", PublicationID: publication.ID, SocialAccountID: account.ID,
		Platform: account.Platform, Profile: models.ContentProfileLongVideo, Status: models.RenditionStatusPublished,
		ExternalID: "video-managed", CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	require.NoError(t, func() error { _, err := db.NewInsert().Model(&rendition).Exec(t.Context()); return err }())

	adapter := &fakeBatchAccountContentDiscoverer{
		fakeAccountContentDiscoverer: &fakeAccountContentDiscoverer{
			support: platform.AccountContentDiscoverySupport{Supported: true, RequiredScopes: []string{"content.read"}},
			discover: func(context.Context, string, platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
				managed := discoveryItem("video-managed", now.Add(-time.Hour))
				external := discoveryItem("video-external", now.Add(-2*time.Hour))
				return platform.AccountContentPage{
					Items:    []platform.AccountContentItem{managed, external, managed},
					Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryComplete},
				}, nil
			},
		},
		measure: func(_ context.Context, token string, request platform.AccountContentBatchMeasurementRequest) (platform.AccountContentBatchMeasurements, error) {
			require.Equal(t, "token", token)
			require.Equal(t, []string{"video-managed", "video-external"}, request.ProviderContentIDs)
			lifetime := platform.AnalyticsMetricMetadata{Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal}
			return platform.AccountContentBatchMeasurements{
				"video-external": {platform.MetricViews: {Value: 20, AnalyticsMetricMetadata: lifetime}},
				"video-managed":  {platform.MetricViews: {Value: 10, AnalyticsMetricMetadata: lifetime}},
			}, nil
		},
	}
	service := NewService(db, staticTokenSource{})
	service.SetProvider(account.Platform, adapter)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.now = func() time.Time { return now }
	_, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)
	job := loadDiscoveryJob(t, db, account.ID)
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))

	var contents []models.AccountContent
	require.NoError(t, db.NewSelect().Model(&contents).Where("social_account_id = ?", account.ID).Order("provider_content_id ASC").Scan(t.Context()))
	require.Len(t, contents, 2, "rediscovery and managed matching must share one provider identity row")
	require.Equal(t, "video-external", contents[0].ProviderContentID)
	require.Equal(t, string(platform.AccountContentOriginExternal), contents[0].Origin)
	require.Empty(t, contents[0].RenditionID)
	require.Equal(t, "video-managed", contents[1].ProviderContentID)
	require.Equal(t, string(platform.AccountContentOriginOpenPost), contents[1].Origin)
	require.Equal(t, rendition.ID, contents[1].RenditionID)

	publicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, publicationCount, "external discovery must not synthesize a Publication")
	for _, content := range contents {
		var state models.AnalyticsSyncState
		require.NoError(t, db.NewSelect().Model(&state).Where("subject_type = ? AND subject_id = ?", subjectAccountContent, content.ID).Scan(t.Context()))
		if content.ProviderContentID == "video-external" {
			require.JSONEq(t, `{"views":20}`, state.MetricsJSON)
		} else {
			require.JSONEq(t, `{"views":10}`, state.MetricsJSON)
		}
	}
	var discoveryState models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&discoveryState).Where("social_account_id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, 2, discoveryState.ReadBudgetUsed, "listing and batch measurement reads both consume the durable budget")
}

func TestSocialDiscoveryMatchesManagedRenditionsByExactScopedIdentity(t *testing.T) {
	tests := []struct {
		name            string
		provider        string
		serverURL       string
		accountID       string
		externalID      string
		discoveredValue string
		collisionServer string
	}{
		{
			name: "mastodon instance status", provider: "mastodon", serverURL: "https://one.social", accountID: "account-1",
			externalID: "42", discoveredValue: "42", collisionServer: "https://two.social",
		},
		{
			name: "bluesky PDS repository record", provider: "bluesky", serverURL: "https://one.pds", accountID: "did:plc:founder",
			externalID:      `{"_root":null,"cid":"bafy","uri":"at://did:plc:founder/app.bsky.feed.post/3abc"}`,
			discoveredValue: "at://did:plc:founder/app.bsky.feed.post/3abc", collisionServer: "https://two.pds",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := newAnalyticsTestDB(t)
			account := seedAnalyticsAccount(t, db, "")
			account.Platform = test.provider
			account.InstanceURL = test.serverURL
			account.AccountID = test.accountID
			_, err := db.NewUpdate().Model(&account).Column("platform", "instance_url", "account_id").WherePK().Exec(t.Context())
			require.NoError(t, err)

			now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
			publication := models.Publication{
				ID: "publication-managed", WorkspaceID: account.WorkspaceID, CreatedByID: "user-1", Title: "Managed",
				Intent: "post", ContentProfile: models.ContentProfileShortText, SourceContent: "Managed",
				Status: models.PublicationStatusPublished, ActualRunAt: now, CreatedAt: now, UpdatedAt: now,
			}
			_, err = db.NewInsert().Model(&publication).Exec(t.Context())
			require.NoError(t, err)
			rendition := models.Rendition{
				ID: "rendition-managed", PublicationID: publication.ID, SocialAccountID: account.ID, Platform: test.provider,
				Profile: models.ContentProfileShortText, Status: models.RenditionStatusPublished, ExternalID: test.externalID,
				CreatedAt: now, UpdatedAt: now,
			}
			_, err = db.NewInsert().Model(&rendition).Exec(t.Context())
			require.NoError(t, err)

			exactID, ok := platform.CanonicalSocialAccountContentID(test.provider, test.serverURL, test.accountID, test.discoveredValue)
			require.True(t, ok)
			collisionID, ok := platform.CanonicalSocialAccountContentID(test.provider, test.collisionServer, test.accountID, test.discoveredValue)
			require.True(t, ok)
			matches, err := exactDiscoveryRenditions(t.Context(), db, account, []platform.AccountContentItem{
				{ProviderContentID: exactID, PublishedAt: now},
				{ProviderContentID: collisionID, PublishedAt: now},
			})
			require.NoError(t, err)
			require.Equal(t, map[string]string{exactID: rendition.ID}, matches)
		})
	}
}

func TestDiscoveryCommitsEachPageBeforeCrashSafeContinuationAndDeduplicates(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "content.read")
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	calls := 0
	adapter := &fakeAccountContentDiscoverer{
		support: platform.AccountContentDiscoverySupport{Supported: true, RequiredScopes: []string{"content.read"}, MaxPageSize: 100},
		discover: func(_ context.Context, token string, request platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
			calls++
			require.Equal(t, "token", token)
			require.True(t, now.Add(-initialDiscoveryHistory).Equal(request.PublishedAfter))
			item := discoveryItem("provider-1", now.Add(-time.Hour))
			if request.Cursor == "" {
				return platform.AccountContentPage{Items: []platform.AccountContentItem{item}, NextCursor: "opaque-page-2", Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryPartial, Description: "One page stored."}}, nil
			}
			require.Equal(t, "opaque-page-2", request.Cursor)
			return platform.AccountContentPage{Items: []platform.AccountContentItem{item, discoveryItem("provider-2", now.Add(-2*time.Hour))}, Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryComplete, Description: "Last 90 days are complete."}}, nil
		},
	}
	service := newDiscoveryTestService(db, adapter, now)
	created, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)
	require.True(t, created)

	job := loadDiscoveryJob(t, db, account.ID)
	require.NotContains(t, job.Payload, "opaque-page")
	require.NotContains(t, job.Payload, "token")
	require.NotContains(t, job.Payload, "Launch")

	err = service.HandleJob(t.Context(), job.Type, job.Payload)
	_, continuation := IsDiscoveryContinuation(err)
	require.True(t, continuation)
	var checkpoint models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&checkpoint).Where("social_account_id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, "opaque-page-2", checkpoint.Cursor, "cursor must commit before continuation")
	require.Equal(t, 1, accountContentCount(t, db, account.ID))

	// A worker crash after the page commit retries the same job. The persisted
	// cursor advances the provider read, and a repeated item still has one row.
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Equal(t, 2, calls)
	require.Equal(t, 2, accountContentCount(t, db, account.ID))
	require.NoError(t, db.NewSelect().Model(&checkpoint).Where("social_account_id = ?", account.ID).Scan(t.Context()))
	require.Empty(t, checkpoint.Cursor)
	require.Equal(t, string(platform.AccountContentDiscoveryComplete), checkpoint.CoverageStatus)
	require.False(t, checkpoint.InitialCompletedAt.IsZero())
}

func TestConcurrentAndManualRefreshKeepOneEligibleActiveDiscoveryJob(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	adapter := &fakeAccountContentDiscoverer{
		support: platform.AccountContentDiscoverySupport{Supported: true},
		discover: func(context.Context, string, platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
			return platform.AccountContentPage{Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryComplete}}, nil
		},
	}
	service := newDiscoveryTestService(db, adapter, now)
	_, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)

	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, refreshErr := service.ReconsiderAccountContentDiscovery(context.Background(), account.ID)
			errs <- refreshErr
		}()
	}
	wg.Wait()
	close(errs)
	for refreshErr := range errs {
		require.NoError(t, refreshErr)
	}
	active, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND scope_id = ? AND status IN (?, ?)", jobregistry.TypeAccountContentDiscovery, account.ID, jobregistry.StatusPending, jobregistry.StatusProcessing).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, active)

	job := loadDiscoveryJob(t, db, account.ID)
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", jobregistry.StatusCompleted).Where("id = ?", job.ID).Exec(t.Context())
	require.NoError(t, err)
	created, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)
	require.False(t, created, "manual refresh must not bypass daily routine eligibility")
}

func TestInitialDiscoveryHonorsNinetyDayAndTwoHundredFiftyItemCaps(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	var pageSizes []int
	adapter := &fakeAccountContentDiscoverer{
		support: platform.AccountContentDiscoverySupport{Supported: true, MaxPageSize: 100},
		discover: func(_ context.Context, _ string, request platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
			pageSizes = append(pageSizes, request.PageSize)
			require.True(t, now.Add(-90*24*time.Hour).Equal(request.PublishedAfter))
			items := make([]platform.AccountContentItem, request.PageSize)
			for index := range items {
				items[index] = discoveryItem(fmt.Sprintf("item-%03d-%03d", len(pageSizes), index), now.Add(-time.Hour))
			}
			return platform.AccountContentPage{Items: items, NextCursor: fmt.Sprintf("page-%d", len(pageSizes)+1), Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryPartial}}, nil
		},
	}
	service := newDiscoveryTestService(db, adapter, now)
	_, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)
	job := loadDiscoveryJob(t, db, account.ID)
	for attempt := 0; attempt < 3; attempt++ {
		err = service.HandleJob(t.Context(), job.Type, job.Payload)
		if attempt < 2 {
			_, continuation := IsDiscoveryContinuation(err)
			require.True(t, continuation)
		} else {
			require.NoError(t, err)
		}
	}
	require.Equal(t, []int{100, 100, 50}, pageSizes)
	require.Equal(t, 250, accountContentCount(t, db, account.ID))
	var state models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, 250, state.InitialItemsDiscovered)
	require.Equal(t, string(platform.AccountContentDiscoveryPartial), state.CoverageStatus)
	require.Contains(t, state.CoverageDescription, "250-item")
	require.Empty(t, state.Cursor)
}

func TestDiscoveryPersistsSafeProviderOutcomesAndRetryAfter(t *testing.T) {
	outcomes := []struct {
		name   string
		status platform.AccountContentDiscoveryStatus
		err    error
	}{
		{"permission", platform.AccountContentDiscoveryPermissionRequired, platform.NewAccountContentDiscoveryError(platform.AccountContentDiscoveryPermissionRequired, "missing_scope", 0)},
		{"rate", platform.AccountContentDiscoveryRateLimited, platform.NewAccountContentDiscoveryError(platform.AccountContentDiscoveryRateLimited, "quota", 3*time.Hour)},
		{"cost", platform.AccountContentDiscoveryCostLimited, platform.NewAccountContentDiscoveryError(platform.AccountContentDiscoveryCostLimited, "credits", 0)},
		{"failed", platform.AccountContentDiscoveryFailed, fmt.Errorf("raw provider body with token secret-value")},
	}
	for _, outcome := range outcomes {
		t.Run(outcome.name, func(t *testing.T) {
			db := newAnalyticsTestDB(t)
			account := seedAnalyticsAccount(t, db, "")
			now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
			adapter := &fakeAccountContentDiscoverer{
				support: platform.AccountContentDiscoverySupport{Supported: true},
				discover: func(context.Context, string, platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
					return platform.AccountContentPage{}, outcome.err
				},
			}
			service := newDiscoveryTestService(db, adapter, now)
			_, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
			require.NoError(t, err)
			job := loadDiscoveryJob(t, db, account.ID)
			require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
			var state models.AccountContentDiscoveryState
			require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", account.ID).Scan(t.Context()))
			require.Equal(t, string(outcome.status), state.CoverageStatus)
			require.NotContains(t, state.FailureMessage, "secret-value")
			if outcome.status == platform.AccountContentDiscoveryRateLimited {
				require.True(t, now.Add(3*time.Hour).Equal(state.NextEligibleAt))
			}
		})
	}

	t.Run("unsupported", func(t *testing.T) {
		db := newAnalyticsTestDB(t)
		account := seedAnalyticsAccount(t, db, "")
		now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
		service := newDiscoveryTestService(db, &fakeAccountContentDiscoverer{
			support: platform.AccountContentDiscoverySupport{Supported: false, UnavailableReason: "Provider contract does not allow history."},
		}, now)
		created, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
		require.NoError(t, err)
		require.False(t, created)
		var state models.AccountContentDiscoveryState
		require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", account.ID).Scan(t.Context()))
		require.Equal(t, string(platform.AccountContentDiscoveryUnsupported), state.CoverageStatus)
	})
}

func TestXDiscoveryDefaultsToZeroRequestsAndCostLimited(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	account.Platform = "x"
	_, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = ?", account.Platform).Where("id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	calls := 0
	adapter := &fakeAccountContentDiscoverer{
		support: platform.AccountContentDiscoverySupport{Supported: true},
		discover: func(context.Context, string, platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
			calls++
			return platform.AccountContentPage{}, nil
		},
	}
	service := NewService(db, staticTokenSource{})
	service.SetProvider("x", adapter)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.now = func() time.Time { return now }

	created, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)
	require.False(t, created)
	require.Zero(t, calls, "the default X cost policy must not call the provider")
	var state models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, string(platform.AccountContentDiscoveryCostLimited), state.CoverageStatus)
	require.Equal(t, "provider_read_budget_disabled", state.FailureCode)
}

func TestXDiscoveryUsesOnlyExplicitBoundedReadBudget(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	account.Platform = "x"
	_, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = ?", account.Platform).Where("id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	calls := 0
	adapter := &fakeAccountContentDiscoverer{
		support: platform.AccountContentDiscoverySupport{Supported: true, MaxPageSize: platform.AccountContentMaxPageSize},
		discover: func(_ context.Context, _ string, request platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
			calls++
			require.Equal(t, platform.AccountContentMaxPageSize, request.PageSize)
			return platform.AccountContentPage{Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryComplete}}, nil
		},
	}
	service := NewService(db, staticTokenSource{})
	service.SetProvider("x", adapter)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetDiscoveryPolicy("x", DiscoveryPolicy{ProviderConcurrency: 1, ReadRequestsPerDay: 1, PageSize: platform.AccountContentMaxPageSize})
	service.now = func() time.Time { return now }

	created, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)
	require.True(t, created)
	job := loadDiscoveryJob(t, db, account.ID)
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Equal(t, 1, calls)
	var state models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, 1, state.ReadBudgetUsed)
}

func TestDiscoveryDailyReadBudgetCountsProviderAttempts(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	calls := 0
	adapter := &fakeAccountContentDiscoverer{
		support: platform.AccountContentDiscoverySupport{Supported: true},
		discover: func(context.Context, string, platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
			calls++
			return platform.AccountContentPage{NextCursor: "more", Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryPartial}}, nil
		},
	}
	service := newDiscoveryTestService(db, adapter, now)
	service.SetDiscoveryPolicy("test", DiscoveryPolicy{ProviderConcurrency: 1, ReadRequestsPerDay: 1, PageSize: 100})
	_, err := service.ReconsiderAccountContentDiscovery(t.Context(), account.ID)
	require.NoError(t, err)
	job := loadDiscoveryJob(t, db, account.ID)
	err = service.HandleJob(t.Context(), job.Type, job.Payload)
	_, continuation := IsDiscoveryContinuation(err)
	require.True(t, continuation)
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	require.Equal(t, 1, calls)
	var state models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, 1, state.ReadBudgetUsed)
	require.True(t, now.Add(24*time.Hour).Equal(state.NextEligibleAt), "UTC reset must not bypass daily routine eligibility")
	require.Equal(t, "account_read_budget_exhausted", state.FailureCode)
}

func TestDiscoveryProviderConcurrencyDefersNonWinningActiveJob(t *testing.T) {
	db := newAnalyticsTestDB(t)
	first := seedAnalyticsAccount(t, db, "")
	second := first
	second.ID, second.Slug, second.AccountID = "account-2", "test-account-2", "provider-account-2"
	_, err := db.NewInsert().Model(&second).Exec(t.Context())
	require.NoError(t, err)
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	calls := 0
	adapter := &fakeAccountContentDiscoverer{
		support: platform.AccountContentDiscoverySupport{Supported: true},
		discover: func(context.Context, string, platform.AccountContentDiscoveryRequest) (platform.AccountContentPage, error) {
			calls++
			return platform.AccountContentPage{Coverage: platform.AccountContentCoverage{Status: platform.AccountContentDiscoveryComplete}}, nil
		},
	}
	service := newDiscoveryTestService(db, adapter, now)
	_, err = service.ReconsiderAccountContentDiscovery(t.Context(), first.ID)
	require.NoError(t, err)
	_, err = service.ReconsiderAccountContentDiscovery(t.Context(), second.ID)
	require.NoError(t, err)
	firstJob := loadDiscoveryJob(t, db, first.ID)
	secondJob := loadDiscoveryJob(t, db, second.ID)
	// Force deterministic ordering for the provider-wide slot.
	firstOriginalID, secondOriginalID := firstJob.ID, secondJob.ID
	firstJob.ID, secondJob.ID = "job-a", "job-b"
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", jobregistry.StatusProcessing).Set("id = ?", firstJob.ID).Where("id = ?", firstOriginalID).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", jobregistry.StatusProcessing).Set("id = ?", secondJob.ID).Where("id = ?", secondOriginalID).Exec(t.Context())
	require.NoError(t, err)
	ctx := providerwrite.WithJobExecution(t.Context(), secondJob.ID, 0, now)
	err = service.HandleJob(ctx, secondJob.Type, secondJob.Payload)
	delay, continuation := IsDiscoveryContinuation(err)
	require.True(t, continuation)
	require.Equal(t, providerSlotRetry, delay)
	require.Zero(t, calls)
}

func newDiscoveryTestService(db *bun.DB, adapter platform.Adapter, now time.Time) *Service {
	service := NewService(db, staticTokenSource{})
	service.SetProvider("test", adapter)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.now = func() time.Time { return now }
	return service
}

func discoveryItem(id string, publishedAt time.Time) platform.AccountContentItem {
	return platform.AccountContentItem{
		ProviderContentID: id, ContentProfile: models.ContentProfileShortText,
		Text: "Launch update", PublishedAt: publishedAt,
		Origin: platform.AccountContentOriginExternal,
	}
}

func loadDiscoveryJob(t *testing.T, db *bun.DB, accountID string) models.Job {
	t.Helper()
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).
		Where("type = ? AND scope_id = ?", jobregistry.TypeAccountContentDiscovery, accountID).Scan(t.Context()))
	return job
}

func accountContentCount(t *testing.T, db *bun.DB, accountID string) int {
	t.Helper()
	count, err := db.NewSelect().Model((*models.AccountContent)(nil)).Where("social_account_id = ?", accountID).Count(t.Context())
	require.NoError(t, err)
	return count
}
