package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestTakeawaysRejectInsufficientOrIncompatibleEvidenceAndUnsupportedAccounts(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	metadata := legacyMetricMetadata(platform.AnalyticsValues{"likes": 1}, platform.AnalyticsMetricSubjectContent, "test")
	items := []ContentOverview{insightTestContent("a", "account", "test", now, 10, metadata), insightTestContent("b", "account", "test", now, 10, metadata), insightTestContent("c", "account", "test", now, 40, metadata)}
	for i := range items {
		items[i].Status = "ok"
	}
	require.Len(t, buildTakeaways(items, nil), 1)
	require.Empty(t, buildTakeaways(items[:2], nil))
	items[2].Status = "failed"
	require.Empty(t, buildTakeaways(items, nil))
	items[2].Status = "ok"
	items[2].Metrics[platform.MetricLikes] = 12
	require.Empty(t, buildTakeaways(items, nil), "small improvements do not create a recommendation")
	items[2].Metrics[platform.MetricLikes] = 40
	items[2].MetricMetadata = legacyMetricMetadata(platform.AnalyticsValues{"likes": 1}, platform.AnalyticsMetricSubjectContent, "different_measurement")
	require.Empty(t, buildTakeaways(items, nil))
	accounts := []AccountOverview{{ID: "unsupported", Status: "unsupported"}, {ID: "broken", Status: "permission_required", AccountSupported: true}}
	actions := buildTakeaways(nil, accounts)
	require.Len(t, actions, 1)
	require.Equal(t, "broken", actions[0].AccountID)
}
