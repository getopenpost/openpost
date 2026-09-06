package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBlueskyGrowthDiscoveryBoundedAndFilters(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	viewerID := "did:plc:viewer"
	// Viewer follows 15 accounts (should only seed 12)
	viewerFollows := make([]blueskyGrowthProfile, 0, 16)
	for i := 0; i < 15; i++ {
		viewerFollows = append(viewerFollows, blueskyGrowthProfile{DID: fmt.Sprintf("did:plc:seed%d", i), Handle: fmt.Sprintf("seed%d.test", i), DisplayName: fmt.Sprintf("Seed %d", i)})
	}
	for i := range viewerFollows {
		viewerFollows[i] = blueskyGrowthProfile{DID: fmt.Sprintf("did:plc:seed%d", i), Handle: fmt.Sprintf("seed%d.test", i), DisplayName: fmt.Sprintf("Seed %d", i)}
	}

	// Track calls
	var getFollowsCalls []string
	var getSuggestionsCalls int
	var getProfilesBatches [][]string
	followURIRequests := 0

	// For dedupe and filtering checks:
	// - candidate deduped across seed0 and seed1
	// - candidate self (viewerID) in seed0 follows
	// - already-followed candidate (viewer follows did:plc:already)
	// - blocked candidate
	// - malformed (empty DID)
	// - deactivated handle.invalid
	alreadyFollowedDID := "did:plc:already"
	viewerFollows = append(viewerFollows, blueskyGrowthProfile{DID: alreadyFollowedDID, Handle: "already.test"})

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		path := req.URL.Path
		query := req.URL.Query()
		switch {
		case strings.HasSuffix(path, "app.bsky.graph.getFollows"):
			actor := query.Get("actor")
			getFollowsCalls = append(getFollowsCalls, actor)
			if actor == viewerID {
				// Return viewer follows + alreadyFollowedDID for filtering test
				follows := viewerFollows
				// Ensure limit=100 and sort=top
				if query.Get("limit") != "100" || query.Get("sort") != "top" {
					t.Fatalf("getFollows for viewer expected limit=100 sort=top got %v", query)
				}
				resp := blueskyGetFollowsResponse{Follows: follows}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			// Per-seed follows: generate candidates
			// seed0 has a rich set including edge cases
			if actor == "did:plc:seed0" {
				follows := []blueskyGrowthProfile{
					{DID: "did:plc:candidateA", Handle: "canda.test", DisplayName: "A"},
					{DID: viewerID, Handle: "viewer.test"},
					{DID: alreadyFollowedDID, Handle: "already.test"},
					{DID: "did:plc:blocked", Handle: "blocked.test", Viewer: json.RawMessage(`{"muted":true}`)},
					{DID: "", Handle: "empty.test"},
					{DID: "did:plc:deactivated", Handle: "handle.invalid"},
					{DID: "did:plc:dedupe", Handle: "dedupe.test"},
				}
				resp := blueskyGetFollowsResponse{Follows: follows}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			if actor == "did:plc:seed1" {
				follows := []blueskyGrowthProfile{
					{DID: "did:plc:dedupe", Handle: "dedupe.test"},
					{DID: "did:plc:candidateB", Handle: "candb.test"},
				}
				resp := blueskyGetFollowsResponse{Follows: follows}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			// other seeds return one generic candidate
			follows := []blueskyGrowthProfile{{DID: fmt.Sprintf("did:plc:seed-%s-cand", actor[len(actor)-1:]), Handle: "generic.test"}}
			resp := blueskyGetFollowsResponse{Follows: follows}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getSuggestions"):
			getSuggestionsCalls++
			if query.Get("limit") != "100" {
				t.Fatalf("suggestions expected limit=100 got %q", query.Get("limit"))
			}
			resp := blueskySuggestionsResponse{Actors: []blueskyGrowthProfile{
				{DID: "did:plc:suggested", Handle: "suggested.test"},
			}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getProfiles"):
			actors := query["actors"]
			getProfilesBatches = append(getProfilesBatches, actors)
			if len(actors) > 25 {
				t.Fatalf("getProfiles batch too large: %d", len(actors))
			}
			profiles := make([]blueskyGrowthProfile, 0, len(actors))
			for _, did := range actors {
				p := blueskyGrowthProfile{DID: did, Handle: strings.TrimPrefix(did, "did:plc:") + ".test", DisplayName: "Profile " + did, Description: "bio for " + did, Avatar: "https://cdn.test/" + did + ".jpg"}
				// default no knownFollowers -> sampled
				fc := 10
				fgc := 5
				p.FollowersCount = &fc
				p.FollowsCount = &fgc
				profiles = append(profiles, p)
			}
			resp := blueskyGetProfilesResponse{Profiles: profiles}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "com.atproto.repo.createRecord"):
			followURIRequests++
			return jsonResponse(req, `{"uri":"at://did:plc:viewer/app.bsky.graph.follow/abc","cid":"cid123"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, fmt.Errorf("unexpected")
		}
	})}

	adapter := NewBlueskyAdapter("https://bsky.test")

	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{
		AccessToken: "token",
		ViewerID:    viewerID,
		Limit:       20,
	})
	require.NoError(t, err)

	// 12-seed bound: viewerFollows had 15+ seeds, but only 12 per-seed getFollows should be called
	// viewer call + 12 seed calls = 13 getFollows calls total
	require.Len(t, getFollowsCalls, 13, "expected viewer + 12 seed calls")
	require.Equal(t, viewerID, getFollowsCalls[0])
	// Ensure seed0..seed11 called, seed12.. not called
	for i := 0; i < 12; i++ {
		require.Contains(t, getFollowsCalls, fmt.Sprintf("did:plc:seed%d", i))
	}
	require.NotContains(t, getFollowsCalls, "did:plc:seed12")
	require.NotContains(t, getFollowsCalls, "did:plc:seed13")
	require.NotContains(t, getFollowsCalls, "did:plc:seed14")

	// getSuggestions called once
	require.Equal(t, 1, getSuggestionsCalls)

	// getProfiles batch bound 25
	for _, batch := range getProfilesBatches {
		require.LessOrEqual(t, len(batch), 25)
	}

	// dedupe: did:plc:dedupe should appear once
	dedupeCount := 0
	for _, c := range candidates {
		if c.RemoteID == "did:plc:dedupe" {
			dedupeCount++
		}
	}
	require.Equal(t, 1, dedupeCount, "dedupe failed")

	// self filtering: viewerID should not appear
	for _, c := range candidates {
		require.NotEqual(t, viewerID, c.RemoteID, "self not filtered")
	}
	// already-followed filtering
	for _, c := range candidates {
		require.NotEqual(t, alreadyFollowedDID, c.RemoteID, "already-followed not filtered")
	}
	// blocked filtering
	for _, c := range candidates {
		require.NotEqual(t, "did:plc:blocked", c.RemoteID, "blocked not filtered")
	}
	// malformed and deactivated filtering
	for _, c := range candidates {
		require.NotEqual(t, "", c.RemoteID)
		require.NotEqual(t, "did:plc:deactivated", c.RemoteID)
	}
	_ = followURIRequests
}

func TestBlueskyGrowthFollowPayload(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var captured map[string]interface{}
	var capturedHeaders http.Header
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(req.URL.Path, "com.atproto.repo.createRecord") {
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
		if req.Method != http.MethodPost {
			t.Fatalf("expected POST")
		}
		if req.Header.Get("Authorization") != "Bearer token123" {
			t.Fatalf("bad auth %q", req.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(req.Body)
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		capturedHeaders = req.Header
		return jsonResponse(req, `{"uri":"at://did:plc:viewer/app.bsky.graph.follow/rec123","cid":"cid123"}`), nil
	})}

	adapter := NewBlueskyAdapter("https://bsky.test")
	result, err := adapter.FollowGrowthCandidate(context.Background(), "token123", "did:plc:viewer", "did:plc:candidate")
	require.NoError(t, err)
	require.Equal(t, "following", result.ProviderState)
	require.Equal(t, "at://did:plc:viewer/app.bsky.graph.follow/rec123", result.ProviderReference)
	require.Equal(t, "did:plc:viewer", captured["repo"])
	require.Equal(t, "app.bsky.graph.follow", captured["collection"])
	record, ok := captured["record"].(map[string]interface{})
	require.True(t, ok)
	require.Equal(t, "app.bsky.graph.follow", record["$type"])
	require.Equal(t, "did:plc:candidate", record["subject"])
	createdAt, ok := record["createdAt"].(string)
	require.True(t, ok)
	parsed, err := time.Parse(time.RFC3339, createdAt)
	require.NoError(t, err)
	// Must be UTC RFC3339
	require.Equal(t, time.UTC, parsed.Location())
	_ = capturedHeaders

	// Ensure spaced handling: empty candidate should error
	_, err = adapter.FollowGrowthCandidate(context.Background(), "t", "did:plc:viewer", "")
	require.Error(t, err)

	// Ensure http errors not hidden
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponseWithStatus(req, 429, `{"code":"rate_limit"}`), nil
	})}
	_, err = adapter.FollowGrowthCandidate(context.Background(), "t", "did:plc:viewer", "did:plc:cand")
	require.Error(t, err)
	var httpErr *HTTPError
	require.ErrorAs(t, err, &httpErr)
	require.Equal(t, 429, httpErr.StatusCode)
}

func TestBlueskyGrowthHandlesRequestErrors(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponseWithStatus(req, 500, `{"error":"oops"}`), nil
	})}
	adapter := NewBlueskyAdapter("https://bsky.test")
	_, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: "did:plc:viewer", Limit: 5})
	require.Error(t, err)
	var httpErr *HTTPError
	require.ErrorAs(t, err, &httpErr)
}
