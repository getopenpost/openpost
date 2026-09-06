package analytics

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestUpsertAccountContentNormalizesAndDeduplicatesProviderIdentity(t *testing.T) {
	t.Parallel()

	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	service := NewService(db, staticTokenSource{})
	now := time.Date(2026, time.September, 2, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	item := platform.AccountContentItem{
		ProviderContentID: " video-1 ", ContentProfile: models.ContentProfileLongVideo,
		Title: "  Product   update  ", Text: strings.Repeat("界", platform.AccountContentMaxTextCharacters+5) + "\r\n",
		ExternalURL: "https://www.youtube.com/watch?v=video-1", PublishedAt: now.Add(-time.Hour),
		Origin: platform.AccountContentOriginExternal, OriginConfidence: platform.AccountContentOriginConfidenceExact,
		Measurements: platform.AnalyticsMeasurements{
			platform.MetricViews: {
				Value: 42,
				AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
					Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
				},
			},
		},
	}
	// Use the account's provider so URL validation applies the YouTube host
	// allowlist rather than the operator-provider fallback.
	_, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = ?", "youtube").Where("id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)

	first, err := service.UpsertAccountContent(t.Context(), account.ID, item)
	require.NoError(t, err)
	require.Equal(t, "video-1", first.ProviderContentID)
	require.Equal(t, "Product update", first.Title)
	require.Len(t, []rune(first.Text), platform.AccountContentMaxTextCharacters)
	require.Empty(t, first.RenditionID)

	item.Title = "Updated title"
	second, err := service.UpsertAccountContent(t.Context(), account.ID, item)
	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)
	require.Equal(t, "Updated title", second.Title)

	count, err := db.NewSelect().Model((*models.AccountContent)(nil)).Where("social_account_id = ?", account.ID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	snapshotCount, err := db.NewSelect().Model((*models.AnalyticsAccountContentSnapshot)(nil)).Where("account_content_id = ?", first.ID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, snapshotCount, "capture key keeps a retried minute idempotent")

	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("subject_type = ? AND subject_id = ?", subjectAccountContent, first.ID).Scan(t.Context()))
	require.Equal(t, string(platform.AnalyticsStatusOK), state.Status)
	require.JSONEq(t, `{"views":42}`, state.MetricsJSON)
}
