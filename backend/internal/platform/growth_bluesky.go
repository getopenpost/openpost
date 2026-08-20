package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	blueskyGrowthFollowsLimit     = 100
	blueskyGrowthSuggestionsLimit = 100
	blueskyGrowthMaxSeeds         = 12
	blueskyGrowthMaxFinalists     = 40
	blueskyGrowthProfileBatchSize = 25
)

type blueskyGetFollowsResponse struct {
	Follows []blueskyGrowthProfile `json:"follows"`
	Cursor  string                 `json:"cursor"`
}

type blueskyGrowthProfile struct {
	DID            string          `json:"did"`
	Handle         string          `json:"handle"`
	DisplayName    string          `json:"displayName"`
	Description    string          `json:"description"`
	Avatar         string          `json:"avatar"`
	FollowersCount *int            `json:"followersCount"`
	FollowsCount   *int            `json:"followsCount"`
	Viewer         json.RawMessage `json:"viewer"`
}

type blueskySuggestionsResponse struct {
	Actors []blueskyGrowthProfile `json:"actors"`
	Cursor string                 `json:"cursor"`
}

type blueskyGetProfilesResponse struct {
	Profiles []blueskyGrowthProfile `json:"profiles"`
}

type bskyKnownFollowers struct {
	Count     int                    `json:"count"`
	Followers []blueskyGrowthProfile `json:"followers"`
}

type candidateBuilder struct {
	profile        blueskyGrowthProfile
	sampledMutuals []GrowthMutualProfile
	sampledCount   int
	mutualSeeds    map[string]struct{}
	signals        map[string]struct{}
}

//nolint:gocyclo
func (b *BlueskyAdapter) DiscoverGrowthCandidates(ctx context.Context, input GrowthDiscoveryInput) ([]GrowthCandidate, error) {
	if strings.TrimSpace(input.AccessToken) == "" {
		return nil, fmt.Errorf("bluesky discovery requires an access token")
	}
	if strings.TrimSpace(input.ViewerID) == "" {
		return nil, fmt.Errorf("bluesky discovery requires a viewer id")
	}
	limit := normalizeGrowthLimit(input.Limit)

	viewerFollows, err := b.fetchBlueskyFollows(ctx, input.AccessToken, input.ViewerID)
	if err != nil {
		return nil, err
	}

	viewerFollowingSet := make(map[string]struct{}, len(viewerFollows))
	for _, p := range viewerFollows {
		if p.DID != "" {
			viewerFollowingSet[p.DID] = struct{}{}
		}
	}

	seeds := make([]blueskyGrowthProfile, 0, blueskyGrowthMaxSeeds)
	for i := 0; i < len(viewerFollows) && len(seeds) < blueskyGrowthMaxSeeds; i++ {
		p := viewerFollows[i]
		if p.DID == "" || p.Handle == "" {
			continue
		}
		seeds = append(seeds, p)
	}

	builders := make(map[string]*candidateBuilder)

	// Track seed lookup for mutual examples.
	seedByDID := make(map[string]blueskyGrowthProfile, len(seeds))
	for _, s := range seeds {
		seedByDID[s.DID] = s
	}

	for _, seed := range seeds {
		follows, err := b.fetchBlueskyFollows(ctx, input.AccessToken, seed.DID)
		if err != nil {
			return nil, err
		}
		for _, cand := range follows {
			if cand.DID == "" || cand.Handle == "" {
				continue
			}
			if cand.DID == input.ViewerID {
				continue
			}
			if _, already := viewerFollowingSet[cand.DID]; already {
				continue
			}
			if isBlueskyViewerBlockedOrMuted(cand.Viewer) {
				continue
			}
			if isBlueskyDeactivated(cand) {
				continue
			}
			mutualProfile := GrowthMutualProfile{
				RemoteID:    seed.DID,
				Handle:      seed.Handle,
				DisplayName: seed.DisplayName,
				AvatarURL:   seed.Avatar,
			}
			if existing, ok := builders[cand.DID]; ok {
				if _, seen := existing.mutualSeeds[seed.DID]; !seen {
					existing.mutualSeeds[seed.DID] = struct{}{}
					existing.sampledCount++
					if len(existing.sampledMutuals) < 3 {
						existing.sampledMutuals = append(existing.sampledMutuals, mutualProfile)
					}
				}
				existing.signals["friends_of_friends"] = struct{}{}
				continue
			}
			bldr := &candidateBuilder{
				profile:        cand,
				sampledMutuals: []GrowthMutualProfile{mutualProfile},
				sampledCount:   1,
				mutualSeeds:    map[string]struct{}{seed.DID: {}},
				signals:        map[string]struct{}{"friends_of_friends": {}},
			}
			builders[cand.DID] = bldr
		}
	}

	suggestions, err := b.fetchBlueskySuggestions(ctx, input.AccessToken)
	if err != nil {
		return nil, err
	}
	for _, cand := range suggestions {
		if cand.DID == "" || cand.Handle == "" {
			continue
		}
		if cand.DID == input.ViewerID {
			continue
		}
		if _, already := viewerFollowingSet[cand.DID]; already {
			continue
		}
		if isBlueskyViewerBlockedOrMuted(cand.Viewer) {
			continue
		}
		if isBlueskyDeactivated(cand) {
			continue
		}
		if existing, ok := builders[cand.DID]; ok {
			existing.signals["suggestion"] = struct{}{}
			// Keep the richer profile if suggestion has more fields.
			if existing.profile.DisplayName == "" && cand.DisplayName != "" {
				existing.profile.DisplayName = cand.DisplayName
			}
			if existing.profile.Avatar == "" && cand.Avatar != "" {
				existing.profile.Avatar = cand.Avatar
			}
			continue
		}
		builders[cand.DID] = &candidateBuilder{
			profile:     cand,
			mutualSeeds: make(map[string]struct{}),
			signals:     map[string]struct{}{"suggestion": {}},
		}
	}

	// Preliminary rank: sampled mutual evidence + suggestion signal.
	type ranked struct {
		did   string
		b     *candidateBuilder
		score int
	}
	rankedList := make([]ranked, 0, len(builders))
	for did, bldr := range builders {
		score := bldr.sampledCount * 10
		if _, ok := bldr.signals["suggestion"]; ok {
			score += 5
		}
		// slight deterministic tie-breaker: handle alphabetical
		rankedList = append(rankedList, ranked{did: did, b: bldr, score: score})
	}
	sort.Slice(rankedList, func(i, j int) bool {
		if rankedList[i].score != rankedList[j].score {
			return rankedList[i].score > rankedList[j].score
		}
		return rankedList[i].did < rankedList[j].did
	})

	// Select up to maxFinalists after ranking.
	finalCount := len(rankedList)
	if finalCount > blueskyGrowthMaxFinalists {
		finalCount = blueskyGrowthMaxFinalists
	}
	selected := rankedList[:finalCount]
	if len(selected) == 0 {
		return []GrowthCandidate{}, nil
	}

	// Enrich via getProfiles in batches of 25.
	dids := make([]string, 0, len(selected))
	for _, r := range selected {
		dids = append(dids, r.did)
	}
	enriched := make(map[string]blueskyGrowthProfile, len(dids))
	for i := 0; i < len(dids); i += blueskyGrowthProfileBatchSize {
		end := i + blueskyGrowthProfileBatchSize
		if end > len(dids) {
			end = len(dids)
		}
		batch := dids[i:end]
		profiles, err := b.fetchBlueskyProfiles(ctx, input.AccessToken, batch)
		if err != nil {
			return nil, err
		}
		for _, p := range profiles {
			enriched[p.DID] = p
		}
	}

	// Build final candidates preserving ranking order.
	candidates := make([]GrowthCandidate, 0, len(selected))
	for _, r := range selected {
		bldr := r.b
		profile := bldr.profile
		if ep, ok := enriched[r.did]; ok {
			profile = ep
		}
		followersCount := 0
		if profile.FollowersCount != nil {
			followersCount = *profile.FollowersCount
		}
		followingCount := 0
		if profile.FollowsCount != nil {
			followingCount = *profile.FollowsCount
		}

		mutualCount := bldr.sampledCount
		mutuals := bldr.sampledMutuals
		exact := false
		if kf := parseKnownFollowers(profile.Viewer); kf != nil {
			mutualCount = kf.Count
			exact = true
			mutuals = make([]GrowthMutualProfile, 0, len(kf.Followers))
			for _, f := range kf.Followers {
				if len(mutuals) >= 3 {
					break
				}
				if f.DID == "" {
					continue
				}
				mutuals = append(mutuals, GrowthMutualProfile{
					RemoteID:    f.DID,
					Handle:      f.Handle,
					DisplayName: f.DisplayName,
					AvatarURL:   f.Avatar,
				})
			}
		}

		// Extract viewer relations for enriched profile.
		viewerFollowing, viewerFollowedBy := parseViewerFollowState(profile.Viewer)

		signals := make([]string, 0, len(bldr.signals))
		for s := range bldr.signals {
			signals = append(signals, s)
		}
		sort.Strings(signals)

		profileURL := ""
		if profile.Handle != "" {
			profileURL = "https://bsky.app/profile/" + profile.Handle
		} else if profile.DID != "" {
			profileURL = "https://bsky.app/profile/" + profile.DID
		}

		candidates = append(candidates, GrowthCandidate{
			RemoteID:       profile.DID,
			Handle:         profile.Handle,
			DisplayName:    profile.DisplayName,
			Bio:            profile.Description,
			AvatarURL:      profile.Avatar,
			ProfileURL:     profileURL,
			FollowersCount: followersCount,
			FollowingCount: followingCount,
			MutualCount:    mutualCount,
			Mutuals:        mutuals,
			MutualsExact:   exact,
			FollowedBy:     viewerFollowedBy,
			Following:      viewerFollowing,
			Signals:        signals,
		})
	}

	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}

func (b *BlueskyAdapter) FollowGrowthCandidate(ctx context.Context, accessToken, viewerID, candidateID string) (GrowthFollowResult, error) {
	if strings.TrimSpace(accessToken) == "" {
		return GrowthFollowResult{}, fmt.Errorf("bluesky follow requires an access token")
	}
	if strings.TrimSpace(candidateID) == "" {
		return GrowthFollowResult{}, fmt.Errorf("bluesky follow requires a candidate id")
	}
	if strings.TrimSpace(viewerID) == "" {
		return GrowthFollowResult{}, fmt.Errorf("bluesky follow requires a viewer id")
	}
	payload := map[string]interface{}{
		"repo":       viewerID,
		"collection": "app.bsky.graph.follow",
		"record": map[string]interface{}{
			"$type":     "app.bsky.graph.follow",
			"subject":   candidateID,
			"createdAt": time.Now().UTC().Format(time.RFC3339),
		},
	}
	respBody, err := DoJSON(ctx, http.MethodPost, b.pdsURL+"/xrpc/com.atproto.repo.createRecord", payload, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return GrowthFollowResult{}, err
	}
	var result struct {
		URI string `json:"uri"`
		CID string `json:"cid"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return GrowthFollowResult{}, fmt.Errorf("decoding bluesky follow: %w", err)
	}
	if result.URI == "" {
		return GrowthFollowResult{}, fmt.Errorf("bluesky follow returned no uri")
	}
	return GrowthFollowResult{
		ProviderState:     "following",
		ProviderReference: result.URI,
	}, nil
}

func (b *BlueskyAdapter) fetchBlueskyFollows(ctx context.Context, accessToken, actor string) ([]blueskyGrowthProfile, error) {
	endpoint := b.pdsURL + "/xrpc/app.bsky.graph.getFollows?actor=" + url.QueryEscape(actor) + "&limit=" + fmt.Sprint(blueskyGrowthFollowsLimit) + "&sort=top"
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("bluesky getFollows: %w", err)
	}
	var resp blueskyGetFollowsResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("decoding bluesky follows: %w", err)
	}
	return resp.Follows, nil
}

func (b *BlueskyAdapter) fetchBlueskySuggestions(ctx context.Context, accessToken string) ([]blueskyGrowthProfile, error) {
	endpoint := b.pdsURL + "/xrpc/app.bsky.actor.getSuggestions?limit=" + fmt.Sprint(blueskyGrowthSuggestionsLimit)
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("bluesky getSuggestions: %w", err)
	}
	var resp blueskySuggestionsResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("decoding bluesky suggestions: %w", err)
	}
	return resp.Actors, nil
}

func (b *BlueskyAdapter) fetchBlueskyProfiles(ctx context.Context, accessToken string, dids []string) ([]blueskyGrowthProfile, error) {
	if len(dids) == 0 {
		return nil, nil
	}
	if len(dids) > blueskyGrowthProfileBatchSize {
		return nil, fmt.Errorf("bluesky getProfiles batch too large: %d", len(dids))
	}
	params := url.Values{}
	for _, did := range dids {
		params.Add("actors", did)
	}
	endpoint := b.pdsURL + "/xrpc/app.bsky.actor.getProfiles?" + params.Encode()
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("bluesky getProfiles: %w", err)
	}
	var resp blueskyGetProfilesResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("decoding bluesky profiles: %w", err)
	}
	return resp.Profiles, nil
}

//nolint:gocyclo
func isBlueskyViewerBlockedOrMuted(viewer json.RawMessage) bool {
	if len(viewer) == 0 {
		return false
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(viewer, &m); err != nil {
		return false
	}
	// muted: true
	if raw, ok := m["muted"]; ok {
		var muted bool
		if json.Unmarshal(raw, &muted) == nil && muted {
			return true
		}
		// also handle string "true"
		var s string
		if json.Unmarshal(raw, &s) == nil && strings.EqualFold(s, "true") {
			return true
		}
	}
	// blockedBy: true
	if raw, ok := m["blockedBy"]; ok {
		var blockedBy bool
		if json.Unmarshal(raw, &blockedBy) == nil && blockedBy {
			return true
		}
		var s string
		if json.Unmarshal(raw, &s) == nil && s != "" && s != "false" {
			return true
		}
	}
	// blocking: non-empty string/uri
	if raw, ok := m["blocking"]; ok {
		if string(raw) != "null" && string(raw) != `""` && string(raw) != "false" {
			var s string
			if json.Unmarshal(raw, &s) == nil {
				if strings.TrimSpace(s) != "" {
					return true
				}
			} else {
				var b bool
				if json.Unmarshal(raw, &b) == nil && b {
					return true
				}
				trimmed := strings.Trim(string(raw), `" `)
				if trimmed != "" && trimmed != "null" {
					return true
				}
			}
		}
	}
	return false
}

func isBlueskyDeactivated(p blueskyGrowthProfile) bool {
	if strings.EqualFold(p.Handle, "handle.invalid") {
		return true
	}
	// If DID is present but handle missing, treat as unavailable.
	if p.Handle == "" {
		return true
	}
	return false
}

func parseKnownFollowers(viewer json.RawMessage) *bskyKnownFollowers {
	if len(viewer) == 0 {
		return nil
	}
	var holder struct {
		KnownFollowers *bskyKnownFollowers `json:"knownFollowers"`
	}
	if err := json.Unmarshal(viewer, &holder); err != nil {
		return nil
	}
	if holder.KnownFollowers == nil {
		return nil
	}
	return holder.KnownFollowers
}

func parseViewerFollowState(viewer json.RawMessage) (following bool, followedBy bool) {
	if len(viewer) == 0 {
		return false, false
	}
	var holder struct {
		Following  string `json:"following"`
		FollowedBy string `json:"followedBy"`
	}
	_ = json.Unmarshal(viewer, &holder)
	following = strings.TrimSpace(holder.Following) != ""
	followedBy = strings.TrimSpace(holder.FollowedBy) != ""
	return following, followedBy
}

func normalizeGrowthLimit(limit int) int {
	if limit <= 0 {
		return 20
	}
	if limit > 100 {
		return 100
	}
	return limit
}
