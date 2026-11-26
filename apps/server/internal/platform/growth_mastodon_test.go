package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMastodonGrowthRelationshipFilteringFollowsViewer(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://unique.instance.example"
	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		require.Equal(t, "unique.instance.example", req.URL.Host)
		if strings.Contains(req.URL.Path, "/api/v2/suggestions") {
			body := `[
				{"account":{"id":"300","username":"foo","acct":"foo","display_name":"Foo","note":"<p>hi</p>","avatar":"https://cdn.test/foo.jpg","url":"https://mastodon.example/@foo","followers_count":1,"following_count":1},"sources":["friends_of_friends"]},
				{"account":{"id":"301","username":"bar","acct":"bar","display_name":"Bar","note":"<p>hi</p>","avatar":"https://cdn.test/bar.jpg","url":"https://mastodon.example/@bar","followers_count":1,"following_count":1},"sources":["friends_of_friends"]}
			]`
			return jsonResponse(req, body), nil
		}
		if strings.Contains(req.URL.Path, "/api/v1/accounts/familiar_followers") {
			ids := req.URL.Query()["id[]"]
			entries := []mastodonFamiliarFollowersEntry{}
			for _, id := range ids {
				entries = append(entries, mastodonFamiliarFollowersEntry{ID: id, Accounts: []mastodonGrowthAccount{}})
			}
			body, _ := json.Marshal(entries)
			return jsonResponse(req, string(body)), nil
		}
		if strings.Contains(req.URL.Path, "/api/v1/accounts/relationships") {
			rels := []mastodonRelationship{
				{ID: "300", Following: false, FollowedBy: true},
				{ID: "301", Following: false, FollowedBy: false, Muting: true},
			}
			body, _ := json.Marshal(rels)
			return jsonResponse(req, string(body)), nil
		}
		t.Fatalf("unexpected %s", req.URL.String())
		return nil, io.EOF
	})}

	adapter := NewMastodonAdapter("cid", "secret", "https://app.test/callback", instanceURL)
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: "1", Limit: 5})
	require.NoError(t, err)
	// 300 should be present with followedBy true, 301 muted excluded
	require.Equal(t, 3, requests)
	require.Len(t, candidates, 1)
	require.Equal(t, "300", candidates[0].RemoteID)
	require.True(t, candidates[0].FollowedBy)
}
