package analytics

import (
	"context"
	"fmt"
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

func TestDiscoveryProviderConcurrencyLeaseDefersNewLowIDJob(t *testing.T) {
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
	// The already-running owner sorts after the newcomer. A lexical ranking
	// would incorrectly let the newcomer enter the same provider slot.
	firstOriginalID, secondOriginalID := firstJob.ID, secondJob.ID
	firstJob.ID, secondJob.ID = "job-z", "job-a"
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", jobregistry.StatusProcessing).Set("id = ?", firstJob.ID).Where("id = ?", firstOriginalID).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", jobregistry.StatusProcessing).Set("id = ?", secondJob.ID).Where("id = ?", secondOriginalID).Exec(t.Context())
	require.NoError(t, err)
	ownerCtx := providerwrite.WithJobExecution(t.Context(), firstJob.ID, 0, now)
	owner, acquired, err := service.acquireDiscoveryProviderSlot(ownerCtx, first.Platform, 1, now)
	require.NoError(t, err)
	require.True(t, acquired)
	require.Equal(t, firstJob.ID, owner)
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
		Where("type = ? AND scope_id = ?", jobregistry.TypeAccountContentDiscovery, accountID).
		Order("created_at DESC", "id DESC").Limit(1).Scan(t.Context()))
	return job
}

func accountContentCount(t *testing.T, db *bun.DB, accountID string) int {
	t.Helper()
	count, err := db.NewSelect().Model((*models.AccountContent)(nil)).Where("social_account_id = ?", accountID).Count(t.Context())
	require.NoError(t, err)
	return count
}
