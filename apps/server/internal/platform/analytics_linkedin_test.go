package platform

import (
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLinkedInOrganizationFollowersUsesCurrentRestliRequest(t *testing.T) {
	for _, boundary := range []string{"encoded resource key", "current edge type"} {
		t.Run(boundary, func(t *testing.T) {
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				require.Equal(t, "api.linkedin.com", req.URL.Host)
				require.Equal(t, "/rest/networkSizes/urn:li:organization:1234567", req.URL.Path)
				require.Equal(t, "Bearer token", req.Header.Get("Authorization"))
				require.Equal(t, "2.0.0", req.Header.Get("X-Restli-Protocol-Version"))
				require.NotEmpty(t, req.Header.Get("Linkedin-Version"))
				invalid := boundary == "encoded resource key" && strings.Contains(req.URL.EscapedPath(), ":") ||
					boundary == "current edge type" && req.URL.Query().Get("edgeType") != "COMPANY_FOLLOWED_BY_MEMBER"
				if invalid {
					response := jsonResponse(req, `{"status":400,"code":"ILLEGAL_ARGUMENT","message":"Invalid resource key or edge type"}`)
					response.StatusCode = http.StatusBadRequest
					return response, nil
				}
				return jsonResponse(req, `{"firstDegreeSize":219145}`), nil
			})}
			values, err := communityManagementAdapter(t).FetchAccountAnalytics(t.Context(), "token", AccountAnalyticsRequest{AccountID: "urn:li:organization:1234567"})
			require.NoError(t, err)
			require.Equal(t, int64(219145), values[MetricFollowers])
		})
	}
}

func TestLinkedInOrganizationShareAnalyticsPreservesRestliListSyntax(t *testing.T) {
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "/rest/organizationalEntityShareStatistics", req.URL.Path)
		require.Equal(t, "urn:li:organization:2414183", req.URL.Query().Get("organizationalEntity"))
		require.Equal(t, "urn:li:ugcPost:1000002", req.URL.Query().Get("ugcPosts[0]"))
		// Rest.li 2.0 encodes each URN, retaining the list's structural punctuation.
		if !strings.Contains(req.URL.RawQuery, "shares=List(urn%3Ali%3Ashare%3A1000000,urn%3Ali%3Ashare%3A1000001)") {
			response := jsonResponse(req, `{"status":400,"code":"ILLEGAL_ARGUMENT","message":"Invalid query parameters"}`)
			response.StatusCode = http.StatusBadRequest
			return response, nil
		}
		return jsonResponse(req, `{"elements":[{"totalShareStatistics":{"clickCount":78,"commentCount":24,"impressionCount":5287,"likeCount":14,"shareCount":5,"uniqueImpressionsCount":4000}}]}`), nil
	})}
	values, err := communityManagementAdapter(t).FetchContentAnalytics(t.Context(), "token", ContentAnalyticsRequest{
		AccountID:   "urn:li:organization:2414183",
		ExternalIDs: []string{"urn:li:share:1000000", "urn:li:share:1000001", "urn:li:ugcPost:1000002"},
	})
	require.NoError(t, err)
	require.Equal(t, AnalyticsValues{MetricClicks: 78, MetricComments: 24, MetricImpressions: 5287, MetricLikes: 14, MetricShares: 5, MetricReach: 4000}, values)
}
