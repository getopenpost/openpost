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

func TestMastodonGrowthSourceParsing(t *testing.T) {
	// Test singular and plural source forms without failing full response
	cases := []struct {
		body string
		want []string
	}{
		{`[{"account":{"id":"1","username":"alice","acct":"alice","display_name":"Alice","note":"hi","avatar":"https://cdn.test/a.jpg","url":"https://mastodon.test/@alice","followers_count":10,"following_count":5},"source":"friends_of_friends"}]`, []string{"friends_of_friends"}},
		{`[{"account":{"id":"2","username":"bob","acct":"bob","display_name":"Bob","note":"hi","avatar":"https://cdn.test/b.jpg","url":"https://mastodon.test/@bob","followers_count":10,"following_count":5},"sources":["similar_to_recently_followed","most_followed"]}]`, []string{"similar_to_recently_followed", "most_followed"}},
		{`[{"account":{"id":"3","username":"carol","acct":"carol","display_name":"Carol","note":"hi","avatar":"https://cdn.test/c.jpg","url":"https://mastodon.test/@carol","followers_count":10,"following_count":5},"source":"most_interactions","sources":["most_interactions"]}]`, []string{"most_interactions"}},
	}
	for i, tc := range cases {
		var suggestions []mastodonSuggestion
		require.NoError(t, json.Unmarshal([]byte(tc.body), &suggestions), "case %d", i)
		require.Equal(t, tc.want, suggestions[0].signals(), "case %d", i)
	}
}

func TestMastodonGrowthDiscoveryFiltersAndHTML(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://mastodon.example"
	viewerID := "100"

	// Track request counts and URLs
	var familiarBatches [][]string
	var relationshipBatches [][]string
	var suggestionURL string

	suggestionsJSON := `[
		{"account":{"id":"100","username":"viewer","acct":"viewer","display_name":"Viewer","note":"<p>viewer bio</p>","avatar":"https://cdn.test/viewer.jpg","url":"https://mastodon.example/@viewer","followers_count":10,"following_count":5},"sources":["friends_of_friends"]},
		{"account":{"id":"101","username":"alice","acct":"alice","display_name":"Alice","note":"<p>Hello <strong>world</strong></p>","avatar":"https://cdn.test/alice.jpg","url":"https://mastodon.example/@alice","followers_count":20,"following_count":10},"sources":["friends_of_friends"]},
		{"account":{"id":"102","username":"bob","acct":"bob","display_name":"Bob","note":"<p>Bob's bio</p>","avatar":"https://cdn.test/bob.jpg","url":"https://mastodon.example/@bob","followers_count":30,"following_count":15},"source":"most_followed"},
		{"account":{"id":"103","username":"carol","acct":"carol","display_name":"Carol","note":"<p>Carol bio</p>","avatar":"https://cdn.test/carol.jpg","url":"https://mastodon.example/@carol","followers_count":5,"following_count":2},"sources":["most_interactions"]},
		{"account":{"id":"","username":"malformed","acct":"malformed","display_name":"Malformed","note":"hi","avatar":"https://cdn.test/m.jpg","url":"https://mastodon.example/@malformed","followers_count":1,"following_count":1},"sources":["friends_of_friends"]},
		{"account":{"id":"104","username":"dave","acct":"dave","display_name":"Dave","note":"<p>Dave</p><script>alert('xss')</script>","avatar":"https://cdn.test/dave.jpg","url":"https://mastodon.example/@dave","followers_count":8,"following_count":3},"sources":["friends_of_friends"]}
	]`

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if !strings.HasPrefix(req.URL.String(), instanceURL) {
			t.Fatalf("expected instance-relative URL, got %q", req.URL.String())
		}
		switch {
		case strings.Contains(req.URL.Path, "/api/v2/suggestions"):
			suggestionURL = req.URL.String()
			if req.URL.Query().Get("limit") != "80" {
				t.Fatalf("suggestions limit expected 80 got %q", req.URL.Query().Get("limit"))
			}
			return jsonResponse(req, suggestionsJSON), nil
		case strings.Contains(req.URL.Path, "/api/v1/accounts/familiar_followers"):
			ids := req.URL.Query()["id[]"]
			familiarBatches = append(familiarBatches, ids)
			if len(ids) > 40 {
				t.Fatalf("familiar_followers batch too large %d", len(ids))
			}
			var entries []mastodonFamiliarFollowersEntry
			for _, id := range ids {
				// Provide mutual followers for 101
				if id == "101" {
					entries = append(entries, mastodonFamiliarFollowersEntry{ID: "101", Accounts: []mastodonGrowthAccount{{ID: "900", Username: "mutual", Acct: "mutual", DisplayName: "Mutual", Avatar: "https://cdn.test/mutual.jpg"}}})
				} else {
					entries = append(entries, mastodonFamiliarFollowersEntry{ID: id, Accounts: []mastodonGrowthAccount{}})
				}
			}
			body, _ := json.Marshal(entries)
			return jsonResponse(req, string(body)), nil
		case strings.Contains(req.URL.Path, "/api/v1/accounts/relationships"):
			ids := req.URL.Query()["id[]"]
			relationshipBatches = append(relationshipBatches, ids)
			if len(ids) > 40 {
				t.Fatalf("relationships batch too large %d", len(ids))
			}
			var rels []mastodonRelationship
			for _, id := range ids {
				switch id {
				case "101":
					rels = append(rels, mastodonRelationship{ID: "101", Following: false, FollowedBy: true})
				case "102":
					// already-followed
					rels = append(rels, mastodonRelationship{ID: "102", Following: true})
				case "103":
					// blocked
					rels = append(rels, mastodonRelationship{ID: "103", Blocking: true})
				case "104":
					rels = append(rels, mastodonRelationship{ID: "104"})
				case "100":
					// self, but should have been filtered before fetching? Actually we filtered self from pendingList, so not here
					rels = append(rels, mastodonRelationship{ID: "100"})
				}
			}
			body, _ := json.Marshal(rels)
			return jsonResponse(req, string(body)), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, io.EOF
		}
	})}

	adapter := NewMastodonAdapter("cid", "secret", "https://app.test/callback", instanceURL)
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "token", ViewerID: viewerID, Limit: 10})
	require.NoError(t, err)

	// Verify suggestion URL is instance-relative
	require.Contains(t, suggestionURL, instanceURL+"/api/v2/suggestions")

	// Batched calls not exceeding limits
	for _, b := range familiarBatches {
		require.LessOrEqual(t, len(b), 40)
	}
	for _, b := range relationshipBatches {
		require.LessOrEqual(t, len(b), 40)
	}

	// Filtering:
	// - self (100) excluded
	// - malformed (empty id) excluded
	// - 102 already-followed excluded
	// - 103 blocked excluded
	ids := map[string]bool{}
	for _, c := range candidates {
		ids[c.RemoteID] = true
	}
	require.NotContains(t, ids, "100")
	require.NotContains(t, ids, "")
	require.NotContains(t, ids, "102")
	require.NotContains(t, ids, "103")
	// 101 and 104 should remain
	require.Contains(t, ids, "101")
	require.Contains(t, ids, "104")

	// Find 101
	var alice *GrowthCandidate
	for i := range candidates {
		if candidates[i].RemoteID == "101" {
			alice = &candidates[i]
			break
		}
	}
	require.NotNil(t, alice)
	// HTML bio conversion: should be plain text, no HTML tags
	require.Equal(t, "Hello world", alice.Bio)
	require.NotContains(t, alice.Bio, "<")
	require.Equal(t, true, alice.FollowedBy)
	require.Equal(t, false, alice.Following)
	// familiar follower mapping
	require.Equal(t, 1, alice.MutualCount)
	require.Len(t, alice.Mutuals, 1)
	require.Equal(t, "900", alice.Mutuals[0].RemoteID)
	// signals preserved without inventing evidence
	require.Contains(t, alice.Signals, "friends_of_friends")

	// Find 104 Dave: check that bio stripped script content? Our conversion should strip tags but keep text
	var dave *GrowthCandidate
	for i := range candidates {
		if candidates[i].RemoteID == "104" {
			dave = &candidates[i]
			break
		}
	}
	require.NotNil(t, dave)
	require.NotContains(t, dave.Bio, "<script>")
	require.NotContains(t, dave.Bio, "<p>")
	// Ensure external URL preserved but not as HTML
	require.Equal(t, "https://mastodon.example/@dave", dave.ProfileURL)
	require.Equal(t, "https://cdn.test/dave.jpg", dave.AvatarURL)
}

func TestMastodonGrowthHTMLBioConversion(t *testing.T) {
	cases := []struct {
		html         string
		wantContains string
		notContains  string
	}{
		{"<p>Hello <a href=\"https://example.com\">world</a></p>", "Hello world", "<a"},
		{"<p>Line1<br>Line2</p>", "Line1", "<br"},
		{"<p>Before</p><p>After</p>", "Before", "<p"},
		{"", "", "<"},
		{"Plain text", "Plain text", "<"},
	}
	for _, tc := range cases {
		got := mastodonHTMLToText(tc.html)
		require.Contains(t, got, tc.wantContains)
		if tc.notContains != "" {
			require.NotContains(t, got, tc.notContains, "html input %q got %q", tc.html, got)
		}
	}
	// Ensure never returns raw HTML as bio for a typical note
	raw := "<p>Foo <strong>bar</strong> <a href=\"https://example.com\">baz</a></p>"
	converted := mastodonHTMLToText(raw)
	require.NotContains(t, converted, "<p>")
	require.NotContains(t, converted, "<strong>")
	require.NotContains(t, converted, "<a")
	require.Equal(t, "Foo bar baz", converted)
}

func TestMastodonGrowthFamiliarFollowerMapping(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://mastodon.example"
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "/api/v2/suggestions") {
			body := `[{"account":{"id":"200","username":"eve","acct":"eve","display_name":"Eve","note":"<p>hi</p>","avatar":"https://cdn.test/eve.jpg","url":"https://mastodon.example/@eve","followers_count":5,"following_count":2},"sources":["friends_of_friends"]}]`
			return jsonResponse(req, body), nil
		}
		if strings.Contains(req.URL.Path, "/api/v1/accounts/familiar_followers") {
			entries := []mastodonFamiliarFollowersEntry{{ID: "200", Accounts: []mastodonGrowthAccount{{ID: "901", Username: "m1", Acct: "m1", DisplayName: "M1", Avatar: "https://cdn.test/m1.jpg"}, {ID: "902", Username: "m2", Acct: "m2", DisplayName: "M2", Avatar: "https://cdn.test/m2.jpg"}}}}
			body, _ := json.Marshal(entries)
			return jsonResponse(req, string(body)), nil
		}
		if strings.Contains(req.URL.Path, "/api/v1/accounts/relationships") {
			rels := []mastodonRelationship{{ID: "200", Following: false, FollowedBy: false}}
			body, _ := json.Marshal(rels)
			return jsonResponse(req, string(body)), nil
		}
		t.Fatalf("unexpected %s", req.URL.String())
		return nil, io.EOF
	})}

	adapter := NewMastodonAdapter("cid", "secret", "https://app.test/callback", instanceURL)
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: "1", Limit: 5})
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	require.Equal(t, 2, candidates[0].MutualCount)
	require.Len(t, candidates[0].Mutuals, 2)
	require.Equal(t, "901", candidates[0].Mutuals[0].RemoteID)
}

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

func TestMastodonGrowthSignalsPreserved(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://mastodon.example"
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "/api/v2/suggestions") {
			body := `[
				{"account":{"id":"400","username":"x","acct":"x","display_name":"X","note":"<p>hi</p>","avatar":"https://cdn.test/x.jpg","url":"https://mastodon.example/@x","followers_count":1,"following_count":1},"sources":["friends_of_friends","similar_to_recently_followed"]},
				{"account":{"id":"401","username":"y","acct":"y","display_name":"Y","note":"<p>hi</p>","avatar":"https://cdn.test/y.jpg","url":"https://mastodon.example/@y","followers_count":1,"following_count":1},"source":"most_followed"}
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
			rels := []mastodonRelationship{{ID: "400"}, {ID: "401"}}
			body, _ := json.Marshal(rels)
			return jsonResponse(req, string(body)), nil
		}
		t.Fatalf("unexpected %s", req.URL.String())
		return nil, io.EOF
	})}

	adapter := NewMastodonAdapter("cid", "secret", "https://app.test/callback", instanceURL)
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: "1", Limit: 5})
	require.NoError(t, err)
	require.Len(t, candidates, 2)
	// Find 400
	for _, c := range candidates {
		if c.RemoteID == "400" {
			require.Contains(t, c.Signals, "friends_of_friends")
			require.Contains(t, c.Signals, "similar_to_recently_followed")
		}
		if c.RemoteID == "401" {
			require.Contains(t, c.Signals, "most_followed")
		}
		// Ensure we don't invent providers like "trending"
		require.NotContains(t, c.Signals, "trending")
	}
}
