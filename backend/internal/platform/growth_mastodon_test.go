package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMastodonGrowthRelationshipFilteringFollowsViewer(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://mastodon.example"
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
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
	require.Len(t, candidates, 1)
	require.Equal(t, "300", candidates[0].RemoteID)
	require.True(t, candidates[0].FollowedBy)
}

func TestMastodonGrowthFollowRequestedVsFollowingAndInstanceURL(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://mastodon.example"
	var capturedURL string
	var capturedAuth string

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		capturedURL = req.URL.String()
		capturedAuth = req.Header.Get("Authorization")
		if req.Method != http.MethodPost {
			t.Fatalf("expected POST got %s", req.Method)
		}
		if !strings.HasPrefix(capturedURL, instanceURL+"/api/v1/accounts/999/follow") {
			t.Fatalf("expected instance-relative URL, got %q", capturedURL)
		}
		// First call: requested true (locked account)
		if strings.Contains(req.URL.Path, "999") {
			return jsonResponse(req, `{"id":"999","following":false,"requested":true}`), nil
		}
		return jsonResponse(req, `{"id":"888","following":true,"requested":false}`), nil
	})}

	adapter := NewMastodonAdapter("cid", "secret", "https://app.test/callback", instanceURL)
	result, err := adapter.FollowGrowthCandidate(context.Background(), "mytoken", "viewer", "999")
	require.NoError(t, err)
	require.Equal(t, "requested", result.ProviderState)
	require.Equal(t, "999", result.ProviderReference)
	require.Equal(t, "Bearer mytoken", capturedAuth)
	require.True(t, strings.HasPrefix(capturedURL, instanceURL))

	// Test following case with different instance URL to ensure not hardcoded
	instanceURL2 := "https://other.instance"
	adapter2 := NewMastodonAdapter("cid", "secret", "https://app.test/callback", instanceURL2)
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if !strings.HasPrefix(req.URL.String(), instanceURL2) {
			t.Fatalf("expected instance-relative URL for second instance, got %q", req.URL.String())
		}
		return jsonResponse(req, `{"id":"888","following":true,"requested":false}`), nil
	})}
	result, err = adapter2.FollowGrowthCandidate(context.Background(), "tok2", "viewer", "888")
	require.NoError(t, err)
	require.Equal(t, "following", result.ProviderState)
	require.Equal(t, "888", result.ProviderReference)
}

func TestMastodonGrowthInstanceRelativeRequestURLs(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://unique.instance.example"
	var seenURLs []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		seenURLs = append(seenURLs, req.URL.String())
		if strings.Contains(req.URL.Path, "/api/v2/suggestions") {
			return jsonResponse(req, `[]`), nil
		}
		// Should not reach familiar/relationships if no suggestions
		return jsonResponse(req, `[]`), nil
	})}

	adapter := NewMastodonAdapter("cid", "secret", "https://app.test/callback", instanceURL)
	_, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: "1", Limit: 5})
	require.NoError(t, err)
	require.NotEmpty(t, seenURLs)
	for _, u := range seenURLs {
		require.True(t, strings.HasPrefix(u, instanceURL), "expected instance-relative URL got %q", u)
		parsed, _ := url.Parse(u)
		require.NotEmpty(t, parsed.Host)
	}
}
