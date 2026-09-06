package platform

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func metaDiscoveryFixture(t *testing.T, name string) string {
	t.Helper()
	body, err := os.ReadFile("testdata/meta_discovery/" + name)
	require.NoError(t, err)
	return string(body)
}

type metaAccountContentDiscoverer interface {
	AccountContentDiscoverySupport(AnalyticsAccountContext) AccountContentDiscoverySupport
	DiscoverAccountContent(context.Context, string, AccountContentDiscoveryRequest) (AccountContentPage, error)
}

func TestMetaAccountContentDiscoveryPaginatesAndPreservesExactIDsForManagedMatching(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	historyStart := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		name            string
		accountID       string
		scope           string
		firstPath       string
		secondPath      string
		firstFixture    string
		secondFixture   string
		firstID         string
		secondID        string
		firstProfile    string
		secondProfile   string
		secondURL       string
		secondIsPartial bool
		adapter         func() metaAccountContentDiscoverer
	}{
		{
			name: "Facebook Page", accountID: "page-1", scope: "pages_read_engagement",
			firstPath: "/v25.0/page-1/published_posts", secondPath: "/v25.0/page-1/published_posts",
			firstFixture: "facebook_page_1.json", secondFixture: "facebook_page_2.json",
			firstID: "page-1_managed-1", secondID: "page-1_external-2", firstProfile: "image_post", secondProfile: "link_share",
			secondIsPartial: true, adapter: func() metaAccountContentDiscoverer { return NewFacebookAdapter("", "", "") },
		},
		{
			name: "Instagram", accountID: "ig-1", scope: "instagram_basic",
			firstPath: "/v25.0/ig-1/media", secondPath: "/v25.0/ig-1/media",
			firstFixture: "instagram_page_1.json", secondFixture: "instagram_page_2.json",
			firstID: "17890000000000001", secondID: "17890000000000002", firstProfile: "image_post", secondProfile: "short_video",
			secondURL: "https://www.instagram.com/reel/external2/", adapter: func() metaAccountContentDiscoverer { return NewInstagramAdapter("", "", "") },
		},
		{
			name: "Threads", accountID: "threads-1", scope: "threads_basic",
			firstPath: "/v1.0/threads-1/threads", secondPath: "/v1.0/threads-1/threads",
			firstFixture: "threads_page_1.json", secondFixture: "threads_page_2.json",
			firstID: "18000000000000001", secondID: "18000000000000002", firstProfile: "short_text", secondProfile: "short_video",
			secondURL: "https://www.threads.net/@openpost/post/external2", adapter: func() metaAccountContentDiscoverer { return NewThreadsAdapter("", "", "") },
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			calls := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				require.Equal(t, bearerPrefix+"meta-token", req.Header.Get(headerAuthorization))
				require.Empty(t, req.URL.Query().Get(oauthParamAccessToken), "credential must not be copied into the listing URL")
				require.Equal(t, "2", req.URL.Query().Get("limit"))
				require.Contains(t, req.URL.Query().Get("fields"), "id")
				switch calls {
				case 1:
					require.Equal(t, test.firstPath, req.URL.Path)
					require.Empty(t, req.URL.Query().Get("after"))
					return jsonResponse(req, metaDiscoveryFixture(t, test.firstFixture)), nil
				case 2:
					require.Equal(t, test.secondPath, req.URL.Path)
					require.NotEmpty(t, req.URL.Query().Get("after"))
					return jsonResponse(req, metaDiscoveryFixture(t, test.secondFixture)), nil
				default:
					t.Fatalf("unexpected request %s", req.URL.String())
					return nil, nil
				}
			})}

			adapter := test.adapter()
			first, err := adapter.DiscoverAccountContent(t.Context(), "meta-token", AccountContentDiscoveryRequest{
				AccountID: test.accountID, GrantedScopes: []string{test.scope}, PublishedAfter: historyStart, PageSize: 2,
			})
			require.NoError(t, err)
			require.Len(t, first.Items, 1, "duplicate edge rows must share one exact provider identity")
			require.Equal(t, test.firstID, first.Items[0].ProviderContentID)
			require.Equal(t, test.accountID, first.Items[0].ProviderParentID)
			require.Equal(t, test.firstProfile, first.Items[0].ContentProfile)
			require.Equal(t, AccountContentOriginExternal, first.Items[0].Origin)
			require.Equal(t, AccountContentOriginConfidenceExact, first.Items[0].OriginConfidence)
			require.NotEmpty(t, first.NextCursor)
			require.Equal(t, AccountContentDiscoveryPartial, first.Coverage.Status)

			second, err := adapter.DiscoverAccountContent(t.Context(), "meta-token", AccountContentDiscoveryRequest{
				AccountID: test.accountID, GrantedScopes: []string{test.scope}, Cursor: first.NextCursor,
				PublishedAfter: historyStart, PageSize: 2,
			})
			require.NoError(t, err)
			require.Len(t, second.Items, 1)
			require.Equal(t, test.secondID, second.Items[0].ProviderContentID)
			require.Equal(t, test.secondProfile, second.Items[0].ContentProfile)
			require.Equal(t, test.secondURL, second.Items[0].ExternalURL)
			require.Empty(t, second.NextCursor)
			if test.secondIsPartial {
				require.Equal(t, AccountContentDiscoveryPartial, second.Coverage.Status)
				require.Contains(t, second.Coverage.Description, "omitted safely")
			} else {
				require.Equal(t, AccountContentDiscoveryComplete, second.Coverage.Status)
			}
			require.Equal(t, 2, calls)
		})
	}
}
