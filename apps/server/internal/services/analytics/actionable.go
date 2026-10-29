package analytics

import (
	"encoding/json"
	"sort"

	"github.com/openpost/backend/internal/platform"
)

type ContentVisibility struct {
	Value  int64  `json:"value"`
	Metric string `json:"metric" enum:"views,impressions"`
	Basis  string `json:"basis" enum:"post_displays,content_views,video_views"`
}

type VisibilityBreakdown struct {
	Platform string `json:"platform"`
	Metric   string `json:"metric" enum:"views,impressions"`
	Basis    string `json:"basis" enum:"post_displays,content_views,video_views"`
	Value    int64  `json:"value"`
	Measured int    `json:"measured"`
}

type AccountPerformance struct {
	AccountID        string        `json:"account_id"`
	Platform         string        `json:"platform"`
	Username         string        `json:"username"`
	AvatarURL        string        `json:"avatar_url,omitempty"`
	Published        int           `json:"published"`
	PublicationCount int           `json:"publication_count"`
	Visibility       MetricSummary `json:"visibility"`
	Engagement       MetricSummary `json:"engagement"`
	Followers        *int64        `json:"followers,omitempty"`
	FollowerDelta    *int64        `json:"follower_delta,omitempty"`
	Status           string        `json:"status"`
}

type Takeaway struct {
	Kind             string            `json:"kind" enum:"repurpose_post,restore_measurements"`
	AccountID        string            `json:"account_id"`
	Platform         string            `json:"platform"`
	Username         string            `json:"username"`
	Reference        *ContentReference `json:"reference,omitempty"`
	Title            string            `json:"title,omitempty"`
	Excerpt          string            `json:"excerpt,omitempty"`
	Value            int64             `json:"value"`
	Baseline         *float64          `json:"baseline,omitempty"`
	MeasuredCount    int               `json:"measured_count"`
	ComparisonSample int               `json:"comparison_sample"`
	Reason           string            `json:"reason"`
}

func buildTakeaways(content []ContentOverview, accounts []AccountOverview, accountID string) []Takeaway {
	result := measurementRecoveryTakeaways(content, accounts, accountID)
	result = result[:min(1, len(result))]
	groups := map[string][]ContentOverview{}
	for _, item := range content {
		if accountID == "" || item.AccountID == accountID {
			groups[item.AccountID] = append(groups[item.AccountID], item)
		}
	}
	candidates := []Takeaway{}
	for _, items := range groups {
		if candidate := repurposeTakeaway(items); candidate != nil {
			candidates = append(candidates, *candidate)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := float64(candidates[i].Value)-*candidates[i].Baseline, float64(candidates[j].Value)-*candidates[j].Baseline
		if left != right {
			return left > right
		}
		return candidates[i].AccountID < candidates[j].AccountID
	})
	seen := map[string]bool{}
	for _, candidate := range candidates {
		publicationID := candidate.Reference.PublicationID
		if seen[publicationID] {
			continue
		}
		seen[publicationID] = true
		result = append(result, candidate)
		if len(seen) == 2 {
			break
		}
	}
	return result
}

func actionableMeasurementFailure(status string) bool {
	return status == string(platform.AnalyticsStatusPermissionRequired) || status == string(platform.AnalyticsStatusFailed)
}

func engagementEvidenceSignature(item ContentOverview) string {
	metadata := map[string]platform.AnalyticsMetricMetadata{}
	for _, metric := range engagementProjectionMetricNames(item.Metrics) {
		if _, present := item.Metrics[metric]; present {
			metadata[metric] = item.MetricMetadata[metric]
		}
	}
	encoded, _ := json.Marshal(metadata)
	return string(encoded)
}

func measurementRecoveryTakeaways(content []ContentOverview, accounts []AccountOverview, accountID string) []Takeaway {
	result := []Takeaway{}
	for _, account := range accounts {
		if accountID != "" && account.ID != accountID {
			continue
		}
		if (!account.AccountSupported && !account.ContentSupported) || account.ErrorCode == "feature_disabled" {
			continue
		}
		failure := account.Status
		for _, item := range content {
			if item.AccountID == account.ID && item.ErrorCode != "feature_disabled" && actionableMeasurementFailure(item.Status) {
				failure = item.Status
				break
			}
		}
		if !actionableMeasurementFailure(failure) {
			continue
		}
		result = append(result, Takeaway{Kind: "restore_measurements", AccountID: account.ID, Platform: account.Platform, Username: account.Username, Reason: failure})
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].AccountID < result[j].AccountID })
	return result
}

func repurposeTakeaway(items []ContentOverview) *Takeaway {
	measured, semantics, _ := comparableEngagementContent(items)
	if semantics != 1 || len(measured) < 3 {
		return nil
	}
	signature := engagementEvidenceSignature(measured[0].content)
	compatible := true
	for _, item := range measured[1:] {
		if engagementEvidenceSignature(item.content) != signature {
			compatible = false
			break
		}
	}
	if !compatible {
		return nil
	}
	sortMeasuredEngagement(measured, true)
	winner := measured[0]
	if winner.content.Status != string(platform.AnalyticsStatusOK) || winner.content.Stale || winner.content.CollectedAt.IsZero() {
		return nil
	}
	var total int64
	for _, item := range measured[1:] {
		total += item.value
	}
	baseline := float64(total) / float64(len(measured)-1)
	if winner.value < 3 || float64(winner.value) < 1.5*baseline {
		return nil
	}
	reference := winner.content.Reference
	return &Takeaway{Kind: "repurpose_post", AccountID: winner.content.AccountID, Platform: winner.content.Platform, Username: winner.content.Username, Reference: &reference, Title: winner.content.Title, Excerpt: winner.content.Excerpt, Value: winner.value, Baseline: &baseline, MeasuredCount: len(measured), ComparisonSample: len(measured) - 1, Reason: "above_account_engagement_baseline"}
}
