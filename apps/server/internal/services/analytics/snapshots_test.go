package analytics

import (
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestOverviewInsightsUseLatestStoredSnapshotsAcrossTheFullFilteredPopulation(t *testing.T) {
	t.Parallel()
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			db := analyticsSnapshotTestDB(t, backend,
				(*models.Publication)(nil), (*models.Rendition)(nil), (*models.SocialAccount)(nil),
				(*models.AnalyticsSyncState)(nil), (*models.AnalyticsAccountSnapshot)(nil))
			now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
			metadata := `{"likes":{"unit":"count","aggregation":"lifetime_total","source":"provider"},"views":{"unit":"count","aggregation":"lifetime_total","source":"provider"}}`
			for i := range 2 {
				account := models.SocialAccount{ID: fmt.Sprintf("account-%d", i), WorkspaceID: "workspace", Platform: "test", AccountUsername: fmt.Sprintf("person-%d", i), IsActive: true, AccessTokenEnc: []byte("fixture-token")}
				_, err := db.NewInsert().Model(&account).Exec(t.Context())
				require.NoError(t, err)
			}
			for i := range 3 {
				id := fmt.Sprintf("post-%d", i)
				accountID := fmt.Sprintf("account-%d", i%2)
				publication := models.Publication{ID: id, WorkspaceID: "workspace", CreatedByID: "user", Status: models.PublicationStatusPublished, ActualRunAt: now.Add(-24 * time.Hour), Title: id}
				rendition := models.Rendition{ID: id, PublicationID: id, SocialAccountID: accountID, Platform: "test", Status: models.RenditionStatusPublished}
				state := models.AnalyticsSyncState{ID: stateID(subjectRendition, id), WorkspaceID: "workspace", SubjectType: subjectRendition, SubjectID: id, SocialAccountID: accountID, Platform: "test", Status: "ready", MetricsJSON: `{"likes":9999}`, MetricMetadataJSON: metadata, LastSuccessAt: now}
				for _, row := range []any{&publication, &rendition, &state} {
					_, err := db.NewInsert().Model(row).Exec(t.Context())
					require.NoError(t, err)
				}
				if i == 2 {
					continue
				}
				for n, values := range []string{`{"likes":1000,"views":1}`, fmt.Sprintf(`{"likes":%d,"views":%d}`, 10*(i+1), 10*(i+1))} {
					captured := now.Add(-2 * time.Hour)
					if n == 1 {
						captured = now.Add(-time.Hour)
					}
					snapshot := models.AnalyticsRenditionSnapshot{ID: fmt.Sprintf("%s-%d", id, n), WorkspaceID: "workspace", PublicationID: id, RenditionID: id, SocialAccountID: accountID, Platform: "test", MetricsJSON: values, MetricMetadataJSON: metadata, CapturedAt: captured}
					_, err := db.NewInsert().Model(&snapshot).Exec(t.Context())
					require.NoError(t, err)
				}
			}
			foreign := models.AnalyticsRenditionSnapshot{ID: "foreign", WorkspaceID: "other-workspace", PublicationID: "post-0", RenditionID: "post-0", SocialAccountID: "account-0", Platform: "test", MetricsJSON: `{"likes":5000,"views":5000}`, MetricMetadataJSON: metadata, CapturedAt: now}
			_, err := db.NewInsert().Model(&foreign).Exec(t.Context())
			require.NoError(t, err)
			service := NewService(db, nil)
			service.now = func() time.Time { return now }
			service.SetProvider("test", &fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true, Content: true}})
			for _, accountID := range []string{"", "account-0"} {
				overview, err := service.OverviewWithOptions(t.Context(), "workspace", 7, OverviewOptions{Limit: 1, AccountID: accountID})
				require.NoError(t, err)
				require.Len(t, overview.Content, 1)
				var insight Insight
				for _, candidate := range overview.Insights {
					if candidate.Kind == InsightKindMostEngagementActions {
						insight = candidate
					}
				}
				require.Len(t, overview.Trends.Views, 1)
				if accountID == "" {
					require.Equal(t, InsightStatusAvailable, insight.Status)
					require.Equal(t, int64(20), *insight.Value)
					require.Equal(t, "post-1", insight.Content.Reference.RenditionID)
					require.Equal(t, 2, insight.MeasuredCount)
					require.Equal(t, 3, insight.ComparisonSample)
					require.Equal(t, int64(30), overview.Trends.Views[0].Value)
				} else {
					require.Equal(t, InsightStatusInsufficientData, insight.Status)
					require.Equal(t, 1, insight.MeasuredCount)
					require.Equal(t, 2, insight.ComparisonSample)
					require.Equal(t, int64(10), overview.Trends.Views[0].Value)
				}
			}
		})
	}
}

func TestOverviewTrendBaselinePrecedesTheRangeBoundary(t *testing.T) {
	t.Parallel()
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			for _, baseline := range []struct {
				name string
				age  time.Duration
			}{
				{"previous_day", 24 * time.Hour},
				{"same_day", time.Hour},
			} {
				t.Run(baseline.name, func(t *testing.T) {
					db := analyticsSnapshotTestDB(t, backend,
						(*models.Publication)(nil), (*models.Rendition)(nil), (*models.SocialAccount)(nil),
						(*models.AnalyticsSyncState)(nil), (*models.AnalyticsAccountSnapshot)(nil))
					now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
					start := now.Add(-7 * 24 * time.Hour)
					account := models.SocialAccount{ID: "account", WorkspaceID: "workspace", Platform: "test", AccessTokenEnc: []byte("fixture-token"), IsActive: true}
					publication := models.Publication{ID: "post", WorkspaceID: "workspace", CreatedByID: "user", Status: models.PublicationStatusPublished, ActualRunAt: now.Add(-30 * 24 * time.Hour)}
					rendition := models.Rendition{ID: "rendition", PublicationID: "post", SocialAccountID: "account", Platform: "test", Status: models.RenditionStatusPublished}
					for _, row := range []any{&account, &publication, &rendition} {
						_, err := db.NewInsert().Model(row).Exec(t.Context())
						require.NoError(t, err)
					}
					for i, capture := range []struct {
						at    time.Time
						views int
					}{
						{start.Add(-baseline.age), 2}, {start, 6}, {start.Add(time.Hour), 7}, {now.Add(-time.Hour), 11},
					} {
						snapshot := models.AnalyticsRenditionSnapshot{
							ID: fmt.Sprintf("snapshot-%d", i), WorkspaceID: "workspace", PublicationID: "post", RenditionID: "rendition", SocialAccountID: "account", Platform: "test", CapturedAt: capture.at,
							MetricsJSON:        fmt.Sprintf(`{"views":%d}`, capture.views),
							MetricMetadataJSON: `{"views":{"unit":"count","aggregation":"lifetime_total","source":"provider"}}`,
						}
						_, err := db.NewInsert().Model(&snapshot).Exec(t.Context())
						require.NoError(t, err)
					}
					service := NewService(db, nil)
					service.now = func() time.Time { return now }
					overview, err := service.Overview(t.Context(), "workspace", 7)
					require.NoError(t, err)
					require.Empty(t, overview.Content, "the older publication remains outside the authored-content range")
					require.Len(t, overview.Trends.Views, 2)
					require.Equal(t, start.Format("2006-01-02"), overview.Trends.Views[0].Date)
					require.Equal(t, int64(5), overview.Trends.Views[0].Value)
					require.Equal(t, now.Format("2006-01-02"), overview.Trends.Views[1].Date)
					require.Equal(t, int64(4), overview.Trends.Views[1].Value)
				})
			}
		})
	}
}
