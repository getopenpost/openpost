package analytics

import (
	"context"
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

func TestUpsertAccountContentKeepsDistinctCallerCapturesWithinOneMinute(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	service := NewService(db, staticTokenSource{})
	capturedAt := time.Date(2026, time.September, 2, 12, 0, 5, 0, time.UTC)
	service.now = func() time.Time { return capturedAt }
	item := platform.AccountContentItem{
		ProviderContentID: "post-1", ContentProfile: models.ContentProfileShortText,
		Text: "Update", PublishedAt: capturedAt.Add(-time.Hour), Origin: platform.AccountContentOriginExternal,
		MeasurementCaptureKey: "provider-capture-1",
		Measurements: platform.AnalyticsMeasurements{platform.MetricReactions: {
			Value: 1, AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
				Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
			},
		}},
	}
	content, err := service.UpsertAccountContent(t.Context(), account.ID, item)
	require.NoError(t, err)
	item.MeasurementCaptureKey = "provider-capture-2"
	item.Measurements[platform.MetricReactions] = platform.AnalyticsMeasurement{
		Value: 2, AnalyticsMetricMetadata: item.Measurements[platform.MetricReactions].AnalyticsMetricMetadata,
	}
	_, err = service.UpsertAccountContent(t.Context(), account.ID, item)
	require.NoError(t, err)

	var snapshots []models.AnalyticsAccountContentSnapshot
	require.NoError(t, db.NewSelect().Model(&snapshots).Where("account_content_id = ?", content.ID).Order("id ASC").Scan(t.Context()))
	require.Len(t, snapshots, 2)
	values := []string{snapshots[0].MetricsJSON, snapshots[1].MetricsJSON}
	require.ElementsMatch(t, []string{`{"reactions":1}`, `{"reactions":2}`}, values)
}

func TestUpsertAccountContentReconcilesObservationThatArrivedBeforeInventory(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	service := NewService(db, staticTokenSource{})
	observedAt := time.Date(2026, time.September, 2, 12, 0, 5, 0, time.UTC)
	service.now = func() time.Time { return observedAt.Add(time.Minute) }
	measurements := platform.AnalyticsMeasurements{platform.MetricReactions: {
		Value: 9, AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
			Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
		},
	}}
	require.NoError(t, service.RecordAccountContentObservation(
		t.Context(), account.ID, "update-9", "message-9", "reaction_count", measurements, observedAt,
	))

	content, err := service.UpsertAccountContent(t.Context(), account.ID, platform.AccountContentItem{
		ProviderContentID: "message-9", ContentProfile: models.ContentProfileShortText,
		Text: "Launch", PublishedAt: observedAt.Add(-time.Hour), Origin: platform.AccountContentOriginExternal,
	})
	require.NoError(t, err)
	var observation models.AccountContentObservation
	require.NoError(t, db.NewSelect().Model(&observation).Where("provider_observation_id = ?", "update-9").Scan(t.Context()))
	require.Equal(t, content.ID, observation.AccountContentID)
	var snapshot models.AnalyticsAccountContentSnapshot
	require.NoError(t, db.NewSelect().Model(&snapshot).Where("account_content_id = ?", content.ID).Scan(t.Context()))
	require.JSONEq(t, `{"reactions":9}`, snapshot.MetricsJSON)
	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("subject_type = ? AND subject_id = ?", subjectAccountContent, content.ID).Scan(t.Context()))
	require.JSONEq(t, `{"reactions":9}`, state.MetricsJSON)
}

func TestUpsertAccountContentRejectsUnsafeURLAndMismatchedRendition(t *testing.T) {
	t.Parallel()

	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	service := NewService(db, staticTokenSource{})
	item := platform.AccountContentItem{
		ProviderContentID: "item-1", ContentProfile: models.ContentProfileShortText,
		Text: "hello", ExternalURL: "javascript:alert(1)", PublishedAt: time.Now().UTC(),
		Origin: platform.AccountContentOriginExternal,
	}
	_, err := service.UpsertAccountContent(context.Background(), account.ID, item)
	require.ErrorContains(t, err, "URL is unsafe")

	item.ExternalURL = "https://provider.example/item-1"
	item.RenditionID = "missing-rendition"
	_, err = service.UpsertAccountContent(context.Background(), account.ID, item)
	require.ErrorContains(t, err, "not an exact match")
}
