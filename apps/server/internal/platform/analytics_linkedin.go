package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const (
	linkedinScopeMemberProfileAnalytics = "r_member_profileAnalytics"
	linkedinScopeMemberPostAnalytics    = "r_member_postAnalytics"
	linkedinScopeOrganizationAdmin      = "rw_organization_admin"
)

func (l *LinkedInAdapter) AnalyticsSupport() AnalyticsSupport {
	if !l.enableOrganizations {
		return linkedinCommunityManagementUnavailable()
	}
	return AnalyticsSupport{Account: true, Content: true}
}

func (l *LinkedInAdapter) AnalyticsSupportForAccount(input AnalyticsAccountContext) AnalyticsSupport {
	if !l.enableOrganizations {
		return linkedinCommunityManagementUnavailable()
	}
	if linkedinAnalyticsAccountType(input.AccountID, input.CapabilityState) == "organization" {
		return AnalyticsSupport{
			Account:               true,
			Content:               true,
			AccountRequiredScopes: []string{linkedinScopeOrganizationAdmin},
			ContentRequiredScopes: []string{linkedinScopeOrganizationAdmin},
		}
	}
	return AnalyticsSupport{
		Account:               true,
		Content:               true,
		AccountRequiredScopes: []string{linkedinScopeMemberProfileAnalytics},
		ContentRequiredScopes: []string{linkedinScopeMemberPostAnalytics},
	}
}

func linkedinCommunityManagementUnavailable() AnalyticsSupport {
	return AnalyticsSupport{
		Account:            false,
		Content:            false,
		AccountUnavailable: "LinkedIn analytics require Community Management API access for this OpenPost installation.",
		ContentUnavailable: "LinkedIn analytics require Community Management API access for this OpenPost installation.",
	}
}

func linkedinAnalyticsAccountType(accountID string, capabilityState map[string]string) string {
	if accountType := strings.TrimSpace(capabilityState["linkedin_account_type"]); accountType != "" {
		return accountType
	}
	if strings.HasPrefix(strings.TrimSpace(accountID), "urn:li:organization") {
		return "organization"
	}
	return "person"
}

func (l *LinkedInAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	if linkedinAnalyticsAccountType(input.AccountID, input.CapabilityState) == "organization" {
		return fetchLinkedInOrganizationFollowers(ctx, accessToken, linkedInAuthorURN(input.AccountID))
	}
	return fetchLinkedInMemberFollowers(ctx, accessToken)
}

func fetchLinkedInMemberFollowers(ctx context.Context, accessToken string) (AnalyticsValues, error) {
	body, err := DoRequest(
		ctx,
		http.MethodGet,
		"https://api.linkedin.com/rest/memberFollowersCount?q=me",
		nil,
		linkedinHeaders(accessToken, linkedInAPIVersion()),
	)
	if err != nil {
		return nil, fmt.Errorf("linkedin member followers: %w", err)
	}
	var response struct {
		Elements []struct {
			Count *int64 `json:"memberFollowersCount"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding linkedin member followers: %w", err)
	}
	if len(response.Elements) == 0 || response.Elements[0].Count == nil {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "linkedin_member_followers_not_found")
	}
	return AnalyticsValues{MetricFollowers: *response.Elements[0].Count}, nil
}

func fetchLinkedInOrganizationFollowers(ctx context.Context, accessToken, organizationURN string) (AnalyticsValues, error) {
	if !strings.HasPrefix(organizationURN, "urn:li:organization") {
		return nil, NewAnalyticsError(AnalyticsStatusUnsupported, "linkedin_organization_required")
	}
	endpoint := "https://api.linkedin.com/rest/networkSizes/" + url.PathEscape(organizationURN) +
		"?edgeType=CompanyFollowedByMember"
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, linkedinHeaders(accessToken, linkedInAPIVersion()))
	if err != nil {
		return nil, fmt.Errorf("linkedin organization followers: %w", err)
	}
	var response struct {
		FirstDegreeSize *int64 `json:"firstDegreeSize"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding linkedin organization followers: %w", err)
	}
	if response.FirstDegreeSize == nil {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "linkedin_organization_followers_not_found")
	}
	return AnalyticsValues{MetricFollowers: *response.FirstDegreeSize}, nil
}

func (l *LinkedInAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	ids := uniqueNonEmpty(input.ExternalIDs)
	if len(ids) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "missing_external_id")
	}
	if strings.HasPrefix(linkedInAuthorURN(input.AccountID), "urn:li:organization") {
		return fetchLinkedInOrganizationContentAnalytics(ctx, accessToken, linkedInAuthorURN(input.AccountID), ids)
	}
	return fetchLinkedInMemberContentAnalytics(ctx, accessToken, ids)
}

func fetchLinkedInMemberContentAnalytics(ctx context.Context, accessToken string, ids []string) (AnalyticsValues, error) {
	metrics := []struct {
		Query  string
		Metric string
	}{
		{Query: "IMPRESSION", Metric: MetricImpressions},
		{Query: "MEMBERS_REACHED", Metric: MetricReach},
		{Query: "REACTION", Metric: MetricLikes},
		{Query: "COMMENT", Metric: MetricComments},
		{Query: "RESHARE", Metric: MetricReposts},
		{Query: "POST_SAVE", Metric: MetricSaves},
		{Query: "LINK_CLICKS", Metric: MetricClicks},
	}
	values := AnalyticsValues{}
	for _, id := range ids {
		entity, ok := linkedinAnalyticsEntity(id)
		if !ok {
			continue
		}
		for _, metric := range metrics {
			query := url.Values{
				"q":           {"entity"},
				"entity":      {entity},
				"queryType":   {metric.Query},
				"aggregation": {"TOTAL"},
			}
			body, err := DoRequest(
				ctx,
				http.MethodGet,
				"https://api.linkedin.com/rest/memberCreatorPostAnalytics?"+query.Encode(),
				nil,
				linkedinHeaders(accessToken, linkedInAPIVersion()),
			)
			if err != nil {
				return nil, fmt.Errorf("linkedin member post analytics: %w", err)
			}
			var response struct {
				Elements []struct {
					Count int64 `json:"count"`
				} `json:"elements"`
			}
			if err := json.Unmarshal(body, &response); err != nil {
				return nil, fmt.Errorf("decoding linkedin member post analytics: %w", err)
			}
			// A successful empty result is a measured zero. LinkedIn uses a
			// non-success response when the entity itself is unavailable.
			if _, exists := values[metric.Metric]; !exists {
				values[metric.Metric] = 0
			}
			for _, element := range response.Elements {
				values[metric.Metric] += element.Count
			}
		}
	}
	if len(values) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "linkedin_post_not_found")
	}
	return values, nil
}

func linkedinAnalyticsEntity(id string) (string, bool) {
	id = strings.TrimSpace(id)
	switch {
	case strings.HasPrefix(id, "urn:li:share:"):
		return id, true
	case strings.HasPrefix(id, "urn:li:ugcPost:"):
		return id, true
	default:
		return "", false
	}
}

func fetchLinkedInOrganizationContentAnalytics(ctx context.Context, accessToken, organizationURN string, ids []string) (AnalyticsValues, error) {
	query := url.Values{
		"q":                    {"organizationalEntity"},
		"organizationalEntity": {organizationURN},
	}
	shares := make([]string, 0, len(ids))
	ugcPosts := make([]string, 0, len(ids))
	for _, id := range ids {
		switch {
		case strings.HasPrefix(id, "urn:li:share:"):
			shares = append(shares, id)
		case strings.HasPrefix(id, "urn:li:ugcPost:"):
			ugcPosts = append(ugcPosts, id)
		}
	}
	if len(shares) > 0 {
		query.Set("shares", "List("+strings.Join(shares, ",")+")")
	}
	for index, id := range ugcPosts {
		query.Set(fmt.Sprintf("ugcPosts[%d]", index), id)
	}
	if len(shares) == 0 && len(ugcPosts) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "linkedin_post_not_found")
	}
	body, err := DoRequest(
		ctx,
		http.MethodGet,
		"https://api.linkedin.com/rest/organizationalEntityShareStatistics?"+query.Encode(),
		nil,
		linkedinHeaders(accessToken, linkedInAPIVersion()),
	)
	if err != nil {
		return nil, fmt.Errorf("linkedin organization post analytics: %w", err)
	}
	var response struct {
		Elements []struct {
			Statistics struct {
				Clicks            int64 `json:"clickCount"`
				Comments          int64 `json:"commentCount"`
				Impressions       int64 `json:"impressionCount"`
				Likes             int64 `json:"likeCount"`
				Shares            int64 `json:"shareCount"`
				UniqueImpressions int64 `json:"uniqueImpressionsCount"`
			} `json:"totalShareStatistics"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding linkedin organization post analytics: %w", err)
	}
	values := AnalyticsValues{
		MetricClicks:      0,
		MetricComments:    0,
		MetricImpressions: 0,
		MetricLikes:       0,
		MetricShares:      0,
		MetricReach:       0,
	}
	for _, element := range response.Elements {
		values[MetricClicks] += element.Statistics.Clicks
		values[MetricComments] += element.Statistics.Comments
		values[MetricImpressions] += element.Statistics.Impressions
		values[MetricLikes] += element.Statistics.Likes
		values[MetricShares] += element.Statistics.Shares
		values[MetricReach] += element.Statistics.UniqueImpressions
	}
	return values, nil
}
