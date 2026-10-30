package analytics

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestVisibilitySummaryCountsOneCompatibleMetricPerOutput(t *testing.T) {
	content := []ContentOverview{
		{Platform: "linkedin", Metrics: platform.AnalyticsValues{"views": 20, "impressions": 30}, MetricMetadata: legacyMetricMetadata(platform.AnalyticsValues{"views": 20, "impressions": 30}, platform.AnalyticsMetricSubjectContent, "linkedin")},
		{Platform: "youtube", Metrics: platform.AnalyticsValues{"views": 10, "impressions": 900}, MetricMetadata: legacyMetricMetadata(platform.AnalyticsValues{"views": 10, "impressions": 900}, platform.AnalyticsMetricSubjectContent, "youtube")},
		{Platform: "youtube", Metrics: platform.AnalyticsValues{"impressions": 999}, MetricMetadata: legacyMetricMetadata(platform.AnalyticsValues{"impressions": 999}, platform.AnalyticsMetricSubjectContent, "youtube")},
		{Platform: "test", Metrics: platform.AnalyticsValues{"views": 0}, MetricMetadata: legacyMetricMetadata(platform.AnalyticsValues{"views": 0}, platform.AnalyticsMetricSubjectContent, "test")},
		{Platform: "test", Metrics: platform.AnalyticsValues{}},
	}
	summary := summarizeWholeAccountContent(content)
	require.Equal(t, MetricSummary{Value: 40, Measured: 3}, summary.Visibility)
}

func TestActionableOverviewUsesFullPopulationAndImmutableOwnAccountEvidence(t *testing.T) {
	db := newAnalyticsTestDB(t)
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	account := seedAnalyticsAccount(t, db, "")
	retired := models.SocialAccount{ID: "retired", WorkspaceID: account.WorkspaceID, Platform: "test", AccountUsername: "retired", AccessTokenEnc: []byte("fixture"), IsActive: false}
	_, err := db.NewInsert().Model(&retired).Exec(t.Context())
	require.NoError(t, err)
	// SocialAccount.IsActive carries `bun:",default:true"`, so bun omits an
	// explicit false on insert and the database default wins. Force the flag
	// off so the account below is genuinely disconnected.
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = false").Where("id = ?", retired.ID).Exec(t.Context())
	require.NoError(t, err)
	for i, value := range []int{10, 10, 40, 100} {
		id := fmt.Sprintf("output-%d", i)
		publicationID := id
		accountID := account.ID
		if i == 3 {
			publicationID = "output-2"
			accountID = retired.ID
		} else {
			seedAnalyticsPublication(t, db, account.WorkspaceID, publicationID, now.Add(-time.Hour))
		}
		rendition := models.Rendition{ID: id, PublicationID: publicationID, SocialAccountID: accountID, Platform: "test", Status: models.RenditionStatusPublished}
		state := models.AnalyticsSyncState{ID: stateID(subjectRendition, id), WorkspaceID: account.WorkspaceID, SubjectType: subjectRendition, SubjectID: id, SocialAccountID: accountID, Platform: "test", Status: "ok", MetricsJSON: fmt.Sprintf(`{"views":%d,"likes":9999}`, value), LastSuccessAt: now}
		snapshot := models.AnalyticsRenditionSnapshot{ID: id, WorkspaceID: account.WorkspaceID, PublicationID: publicationID, RenditionID: id, SocialAccountID: accountID, Platform: "test", MetricsJSON: fmt.Sprintf(`{"views":%d,"likes":%d}`, value, value), CapturedAt: now.Add(-time.Minute)}
		for _, row := range []any{&rendition, &state, &snapshot} {
			_, err := db.NewInsert().Model(row).Exec(t.Context())
			require.NoError(t, err)
		}
	}
	service := NewService(db, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("test", &fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true, Content: true}})
	overview, err := service.OverviewWithOptions(t.Context(), account.WorkspaceID, 30, OverviewOptions{Limit: 1, Sort: "visibility"})
	require.NoError(t, err)
	require.Len(t, overview.Content, 1)
	require.Equal(t, MetricSummary{Value: 160, Measured: 4}, overview.Summary.Visibility)
	require.Len(t, overview.Performance, 2)
	require.Len(t, overview.Highlights, 3)
	require.Equal(t, "output-3", overview.Highlights[0].RenditionID)
	require.Equal(t, MetricSummary{Value: 140, Measured: 2}, overview.Publications[0].Visibility)
	require.Len(t, overview.Takeaways, 1)
	require.Equal(t, int64(40), overview.Takeaways[0].Value)
	require.Equal(t, float64(10), *overview.Takeaways[0].Baseline)
	require.Equal(t, "output-2", overview.Takeaways[0].Reference.RenditionID)
	encoded, err := json.Marshal(overview.Takeaways[0])
	require.NoError(t, err)
	var takeaway map[string]any
	require.NoError(t, json.Unmarshal(encoded, &takeaway))
	require.Equal(t, "Launch", takeaway["title"])
	require.Equal(t, "Launch", takeaway["excerpt"])
	require.Equal(t, "retired", overview.Performance[0].AccountID, "performance ranks the full population by measured visibility")
	require.Equal(t, "inactive", overview.Performance[0].Status, "historical results must not appear to be another active connection")
	scoped, err := service.OverviewWithOptions(t.Context(), account.WorkspaceID, 30, OverviewOptions{Limit: 1, AccountID: account.ID, Sort: "visibility"})
	require.NoError(t, err)
	require.Len(t, scoped.Performance, 1)
	require.Equal(t, MetricSummary{Value: 60, Measured: 3}, scoped.Summary.Visibility)
	require.Equal(t, "output-2", scoped.Highlights[0].RenditionID)
}

func TestVisibilityRankingKeepsMeasuredZeroBeforeMissingAndDeduplicatesPosts(t *testing.T) {
	items := []ContentOverview{
		{PublicationID: "missing", Reference: ContentReference{RenditionID: "missing"}},
		{PublicationID: "shared", Reference: ContentReference{RenditionID: "zero"}, Visibility: &ContentVisibility{Value: 0}},
		{PublicationID: "shared", Reference: ContentReference{RenditionID: "best"}, Visibility: &ContentVisibility{Value: 2}},
		{PublicationID: "other", Reference: ContentReference{RenditionID: "other"}, Visibility: &ContentVisibility{Value: 0}},
	}
	orderContentOverviews(items, "visibility")
	require.Equal(t, "missing", items[len(items)-1].PublicationID)
	highlights := buildHighlights(items, "visibility")
	require.Len(t, highlights, 2)
	require.Equal(t, "best", highlights[0].Reference.RenditionID)
}

func TestTakeawaysRejectInsufficientOrIncompatibleEvidenceAndUnsupportedAccounts(t *testing.T) {
	now := time.Now().UTC()
	metadata := legacyMetricMetadata(platform.AnalyticsValues{"likes": 1}, platform.AnalyticsMetricSubjectContent, "test")
	items := []ContentOverview{insightTestContent("a", "account", "test", now, 10, metadata), insightTestContent("b", "account", "test", now, 10, metadata), insightTestContent("c", "account", "test", now, 40, metadata)}
	for i := range items {
		items[i].Status = "ok"
	}
	require.Len(t, buildTakeaways(items, nil, ""), 1)
	require.Empty(t, buildTakeaways(items[:2], nil, ""))
	items[2].Status = "failed"
	require.Empty(t, buildTakeaways(items, nil, ""))
	items[2].Status = "ok"
	items[2].Metrics[platform.MetricLikes] = 12
	require.Empty(t, buildTakeaways(items, nil, ""), "small improvements do not create a recommendation")
	items[2].Metrics[platform.MetricLikes] = 40
	items[2].MetricMetadata = legacyMetricMetadata(platform.AnalyticsValues{"likes": 1}, platform.AnalyticsMetricSubjectContent, "different_measurement")
	require.Empty(t, buildTakeaways(items, nil, ""))
	accounts := []AccountOverview{{ID: "unsupported", Status: "unsupported"}, {ID: "broken", Status: "permission_required", AccountSupported: true}}
	actions := buildTakeaways(nil, accounts, "")
	require.Len(t, actions, 1)
	require.Equal(t, "broken", actions[0].AccountID)
}

func TestVisibilityTrendNeverSubtractsAcrossMetricOrSourceChanges(t *testing.T) {
	start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	history := make([]models.AnalyticsRenditionSnapshot, 0, 4)
	for i, sample := range []struct{ values, metadata string }{
		{`{"views":10}`, `{"views":{"unit":"count","aggregation":"lifetime_total","source":"a"}}`},
		{`{"views":20,"impressions":100}`, `{"views":{"unit":"count","aggregation":"lifetime_total","source":"a"},"impressions":{"unit":"count","aggregation":"lifetime_total","source":"a"}}`},
		{`{"impressions":150}`, `{"impressions":{"unit":"count","aggregation":"lifetime_total","source":"b"}}`},
		{`{"impressions":170}`, `{"impressions":{"unit":"count","aggregation":"lifetime_total","source":"b"}}`},
	} {
		history = append(history, models.AnalyticsRenditionSnapshot{RenditionID: "output", Platform: "test", CapturedAt: start.Add(time.Duration(i) * 24 * time.Hour), MetricsJSON: sample.values, MetricMetadataJSON: sample.metadata})
	}
	visibility := map[string][]DailyBreakdownItem{}
	appendRenditionTrend(history, start, start, "post", "user", map[string][]DailyBreakdownItem{}, map[string][]DailyBreakdownItem{}, visibility)
	points := orderedDailyBreakdown(visibility)
	require.Len(t, points, 2)
	require.Equal(t, int64(10), points[0].Value)
	require.Equal(t, int64(20), points[1].Value)
}

func TestTakeawaysReserveRoomAndDeduplicateCrossPostedWinners(t *testing.T) {
	metadata := legacyMetricMetadata(platform.AnalyticsValues{"likes": 1}, platform.AnalyticsMetricSubjectContent, "test")
	items := make([]ContentOverview, 0, 6)
	for _, account := range []string{"a", "b"} {
		for i, value := range []int64{0, 0, 3} {
			item := insightTestContent(fmt.Sprintf("%s-%d", account, i), account, "test", time.Now().UTC(), value, metadata)
			item.Status = "ok"
			if i == 2 {
				item.Reference.PublicationID = "shared-post"
			}
			items = append(items, item)
		}
	}
	actions := buildTakeaways(items, []AccountOverview{{ID: "broken-a", Status: "failed", AccountSupported: true}, {ID: "broken-b", Status: "failed", ContentSupported: true}}, "")
	require.Len(t, actions, 2)
	require.Equal(t, "restore_measurements", actions[0].Kind)
	require.Equal(t, "repurpose_post", actions[1].Kind)
	require.Equal(t, int64(3), actions[1].Value)
	for i := range items {
		items[i].Metrics[platform.MetricLikes] = 0
		if i%3 == 2 {
			items[i].Metrics[platform.MetricLikes] = 1
		}
	}
	require.Empty(t, buildTakeaways(items, nil, ""))
}

func TestRecoveryTakeawaysRespectUnsupportedProvidersAndCollectionChoices(t *testing.T) {
	for _, account := range []AccountOverview{
		{ID: "unsupported", Status: "permission_required", ErrorCode: "feature_disabled"},
		{ID: "opted-out", Status: "permission_required", ErrorCode: "feature_disabled", AccountSupported: true},
	} {
		require.Empty(t, buildTakeaways(nil, []AccountOverview{account}, ""), "unsupported providers and disabled collection are not broken connections")
	}
	actions := buildTakeaways(nil, []AccountOverview{{ID: "expired", Status: "permission_required", ErrorCode: "missing_scope", AccountSupported: true}}, "")
	require.Len(t, actions, 1)
	require.Equal(t, "expired", actions[0].AccountID)
}
