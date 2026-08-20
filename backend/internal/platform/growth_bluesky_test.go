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

func TestBlueskyGrowthMutualHandlingAndFollowedBy(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	viewerID := "did:plc:viewer"

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		path := req.URL.Path
		query := req.URL.Query()
		switch {
		case strings.HasSuffix(path, "app.bsky.graph.getFollows"):
			actor := query.Get("actor")
			if actor == viewerID {
				resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{{DID: "did:plc:seed0", Handle: "seed0.test"}, {DID: "did:plc:seed1", Handle: "seed1.test"}}}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			if actor == "did:plc:seed0" {
				resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{{DID: "did:plc:candidateX", Handle: "candx.test"}}}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			if actor == "did:plc:seed1" {
				resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{{DID: "did:plc:candidateX", Handle: "candx.test"}}}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getSuggestions"):
			resp := blueskySuggestionsResponse{Actors: []blueskyGrowthProfile{}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getProfiles"):
			actors := query["actors"]
			profiles := []blueskyGrowthProfile{}
			for _, did := range actors {
				if did == "did:plc:candidateX" {
					// Test sampled vs exact via two sub-tests? Here sampled
					fc := 42
					fgc := 7
					p := blueskyGrowthProfile{DID: did, Handle: "candx.test", DisplayName: "Cand X", Description: "desc", Avatar: "https://cdn.test/x.jpg", FollowersCount: &fc, FollowsCount: &fgc, Viewer: json.RawMessage(`{"followedBy":"at://did:plc:candidateX/app.bsky.graph.follow/123"}`)}
					profiles = append(profiles, p)
				} else {
					fc := 1
					fgc := 1
					p := blueskyGrowthProfile{DID: did, Handle: "other.test", FollowersCount: &fc, FollowsCount: &fgc}
					profiles = append(profiles, p)
				}
			}
			resp := blueskyGetProfilesResponse{Profiles: profiles}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		default:
			t.Fatalf("unexpected %s", req.URL.String())
			return nil, fmt.Errorf("unexpected")
		}
	})}

	adapter := NewBlueskyAdapter("https://bsky.test")
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: viewerID, Limit: 10})
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	c := candidates[0]
	// sampled mutual handling: candidateX appears in 2 seeds -> mutual count 2 sampled, not exact
	require.Equal(t, 2, c.MutualCount)
	require.False(t, c.MutualsExact)
	require.Len(t, c.Mutuals, 2)
	// followedBy: candidate follows viewer
	require.True(t, c.FollowedBy, "followedBy should be true from viewer.followedBy")
	require.False(t, c.Following)
}

func TestBlueskyGrowthKnownFollowersExact(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	viewerID := "did:plc:viewer"
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		path := req.URL.Path
		query := req.URL.Query()
		switch {
		case strings.HasSuffix(path, "app.bsky.graph.getFollows"):
			actor := query.Get("actor")
			if actor == viewerID {
				resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{{DID: "did:plc:seed0", Handle: "seed0.test"}}}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{{DID: "did:plc:candidateY", Handle: "candy.test"}}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getSuggestions"):
			resp := blueskySuggestionsResponse{Actors: []blueskyGrowthProfile{}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getProfiles"):
			fc := 100
			fgc := 20
			profile := blueskyGrowthProfile{
				DID: "did:plc:candidateY", Handle: "candy.test", DisplayName: "Cand Y", FollowersCount: &fc, FollowsCount: &fgc,
				Viewer: json.RawMessage(`{"knownFollowers":{"count":5,"followers":[{"did":"did:plc:mutual1","handle":"mutual1.test","displayName":"M1","avatar":"https://cdn.test/m1.jpg"},{"did":"did:plc:mutual2","handle":"mutual2.test"}]},"followedBy":"at://x","following":"at://y"}`),
			}
			resp := blueskyGetProfilesResponse{Profiles: []blueskyGrowthProfile{profile}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		default:
			t.Fatalf("unexpected %s", req.URL.String())
			return nil, fmt.Errorf("x")
		}
	})}

	adapter := NewBlueskyAdapter("https://bsky.test")
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: viewerID, Limit: 5})
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	c := candidates[0]
	require.Equal(t, 5, c.MutualCount)
	require.True(t, c.MutualsExact, "knownFollowers should mark exact")
	require.Len(t, c.Mutuals, 2)
	require.Equal(t, "did:plc:mutual1", c.Mutuals[0].RemoteID)
	require.True(t, c.FollowedBy)
	require.True(t, c.Following)
}

func TestBlueskyGrowthProfileBatchBoundAndFinalistLimit(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	viewerID := "did:plc:viewer"
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		path := req.URL.Path
		query := req.URL.Query()
		switch {
		case strings.HasSuffix(path, "app.bsky.graph.getFollows"):
			actor := query.Get("actor")
			if actor == viewerID {
				// 2 seeds
				resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{{DID: "did:plc:seed0", Handle: "seed0.test"}, {DID: "did:plc:seed1", Handle: "seed1.test"}}}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			// Each seed returns 30 distinct candidates, overlapping partially to exceed 40 finalists
			var follows []blueskyGrowthProfile
			for i := 0; i < 30; i++ {
				did := fmt.Sprintf("did:plc:cand%d", i)
				// ensure unique per seed? use same ids across seeds to dedupe but we want many distinct to exceed 40
				// Make seed0 produce 0-29, seed1 produce 30-59
				if actor == "did:plc:seed1" {
					did = fmt.Sprintf("did:plc:cand%d", i+30)
				}
				follows = append(follows, blueskyGrowthProfile{DID: did, Handle: did + ".test"})
			}
			resp := blueskyGetFollowsResponse{Follows: follows}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getSuggestions"):
			resp := blueskySuggestionsResponse{Actors: []blueskyGrowthProfile{}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getProfiles"):
			actors := query["actors"]
			if len(actors) > 25 {
				t.Fatalf("batch too large %d", len(actors))
			}
			profiles := []blueskyGrowthProfile{}
			for _, did := range actors {
				fc := 1
				fgc := 1
				profiles = append(profiles, blueskyGrowthProfile{DID: did, Handle: did + ".test", FollowersCount: &fc, FollowsCount: &fgc})
			}
			resp := blueskyGetProfilesResponse{Profiles: profiles}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		default:
			t.Fatalf("unexpected %s", req.URL.String())
			return nil, fmt.Errorf("x")
		}
	})}

	adapter := NewBlueskyAdapter("https://bsky.test")
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: viewerID, Limit: 100})
	require.NoError(t, err)
	// Should be capped at 40 finalists
	require.LessOrEqual(t, len(candidates), 40)
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

func TestBlueskyGrowthCallerLimitRespected(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	viewerID := "did:plc:viewer"
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		path := req.URL.Path
		query := req.URL.Query()
		switch {
		case strings.HasSuffix(path, "app.bsky.graph.getFollows"):
			actor := query.Get("actor")
			if actor == viewerID {
				resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{{DID: "did:plc:seed0", Handle: "seed0.test"}}}
				body, _ := json.Marshal(resp)
				return jsonResponse(req, string(body)), nil
			}
			resp := blueskyGetFollowsResponse{Follows: []blueskyGrowthProfile{
				{DID: "did:plc:c1", Handle: "c1.test"},
				{DID: "did:plc:c2", Handle: "c2.test"},
				{DID: "did:plc:c3", Handle: "c3.test"},
			}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getSuggestions"):
			resp := blueskySuggestionsResponse{Actors: []blueskyGrowthProfile{}}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		case strings.HasSuffix(path, "app.bsky.actor.getProfiles"):
			actors := query["actors"]
			profiles := []blueskyGrowthProfile{}
			for _, did := range actors {
				fc := 1
				fgc := 1
				profiles = append(profiles, blueskyGrowthProfile{DID: did, Handle: did + ".test", FollowersCount: &fc, FollowsCount: &fgc})
			}
			resp := blueskyGetProfilesResponse{Profiles: profiles}
			body, _ := json.Marshal(resp)
			return jsonResponse(req, string(body)), nil
		default:
			t.Fatalf("unexpected %s", req.URL.String())
			return nil, fmt.Errorf("x")
		}
	})}

	adapter := NewBlueskyAdapter("https://bsky.test")
	candidates, err := adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: viewerID, Limit: 2})
	require.NoError(t, err)
	require.Len(t, candidates, 2)

	// Default limit when 0
	candidates, err = adapter.DiscoverGrowthCandidates(context.Background(), GrowthDiscoveryInput{AccessToken: "t", ViewerID: viewerID, Limit: 0})
	require.NoError(t, err)
	require.NotEmpty(t, candidates)
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
