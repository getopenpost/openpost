package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/net/html"
)

const (
	mastodonSuggestionsLimit       = 80
	mastodonFamiliarBatchSize      = 40
	mastodonRelationshipsBatchSize = 40
)

type mastodonGrowthAccount struct {
	ID             string `json:"id"`
	Username       string `json:"username"`
	Acct           string `json:"acct"`
	DisplayName    string `json:"display_name"`
	Note           string `json:"note"`
	Avatar         string `json:"avatar"`
	AvatarStatic   string `json:"avatar_static"`
	URL            string `json:"url"`
	FollowersCount int    `json:"followers_count"`
	FollowingCount int    `json:"following_count"`
	Locked         bool   `json:"locked"`
}

type mastodonSuggestion struct {
	Account mastodonGrowthAccount `json:"account"`
	Sources []string              `json:"sources"`
	Source  string                `json:"source"`
}

// UnmarshalJSON handles both "source" (string) and "sources" ([]string) without failing.
func (s *mastodonSuggestion) UnmarshalJSON(data []byte) error {
	type rawSuggestion struct {
		Account mastodonGrowthAccount `json:"account"`
		Source  json.RawMessage       `json:"source"`
		Sources json.RawMessage       `json:"sources"`
	}
	var raw rawSuggestion
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	s.Account = raw.Account

	// Parse singular source
	if len(raw.Source) > 0 && string(raw.Source) != "null" {
		var single string
		if err := json.Unmarshal(raw.Source, &single); err == nil {
			s.Source = strings.TrimSpace(single)
		}
	}
	// Parse plural sources
	if len(raw.Sources) > 0 && string(raw.Sources) != "null" {
		var plural []string
		if err := json.Unmarshal(raw.Sources, &plural); err == nil {
			s.Sources = plural
		} else {
			// Some instances may encode sources as a single string even under "sources"
			var single string
			if err2 := json.Unmarshal(raw.Sources, &single); err2 == nil {
				if strings.TrimSpace(single) != "" {
					s.Sources = []string{single}
				}
			}
		}
	}
	// Normalize into Sources slice for caller convenience
	if len(s.Sources) == 0 && s.Source != "" {
		s.Sources = []string{s.Source}
	}
	for i, src := range s.Sources {
		s.Sources[i] = strings.TrimSpace(src)
	}
	return nil
}

func (s mastodonSuggestion) signals() []string {
	if len(s.Sources) > 0 {
		// Return a copy
		out := make([]string, 0, len(s.Sources))
		for _, src := range s.Sources {
			if src != "" {
				out = append(out, src)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if s.Source != "" {
		return []string{s.Source}
	}
	return nil
}

type mastodonFamiliarFollowersEntry struct {
	ID       string                  `json:"id"`
	Accounts []mastodonGrowthAccount `json:"accounts"`
}

type mastodonRelationship struct {
	ID         string `json:"id"`
	Following  bool   `json:"following"`
	FollowedBy bool   `json:"followed_by"`
	Blocking   bool   `json:"blocking"`
	BlockedBy  bool   `json:"blocked_by"`
	Muting     bool   `json:"muting"`
	Requested  bool   `json:"requested"`
}

//nolint:gocyclo
func (m *MastodonAdapter) DiscoverGrowthCandidates(ctx context.Context, input GrowthDiscoveryInput) ([]GrowthCandidate, error) {
	if strings.TrimSpace(input.AccessToken) == "" {
		return nil, fmt.Errorf("mastodon discovery requires an access token")
	}
	if strings.TrimSpace(input.ViewerID) == "" {
		return nil, fmt.Errorf("mastodon discovery requires a viewer id")
	}
	limit := normalizeGrowthLimit(input.Limit)

	suggestions, err := m.fetchMastodonSuggestions(ctx, input.AccessToken)
	if err != nil {
		return nil, err
	}

	// Collect candidate IDs for batch lookups, filtering only malformed/self early.
	type pending struct {
		suggestion mastodonSuggestion
	}
	pendingList := make([]pending, 0, len(suggestions))
	idSet := make([]string, 0, len(suggestions))
	for _, s := range suggestions {
		if s.Account.ID == "" {
			continue
		}
		if s.Account.ID == input.ViewerID {
			continue
		}
		// Malformed: acct empty? Treat missing id as malformed already; also missing username/acct? Keep id-only check.
		pendingList = append(pendingList, pending{suggestion: s})
		idSet = append(idSet, s.Account.ID)
	}

	if len(pendingList) == 0 {
		return []GrowthCandidate{}, nil
	}

	familiarMap, err := m.fetchMastodonFamiliarFollowers(ctx, input.AccessToken, idSet)
	if err != nil {
		return nil, err
	}
	relationshipMap, err := m.fetchMastodonRelationships(ctx, input.AccessToken, idSet)
	if err != nil {
		return nil, err
	}

	candidates := make([]GrowthCandidate, 0, len(pendingList))
	for _, p := range pendingList {
		acct := p.suggestion.Account
		rel := relationshipMap[acct.ID]
		// Exclude already-followed (following or pending requested)
		if rel != nil && (rel.Following || rel.Requested) {
			continue
		}
		if rel != nil && (rel.Blocking || rel.BlockedBy || rel.Muting) {
			continue
		}
		// Also exclude malformed accounts where handle is completely missing
		if strings.TrimSpace(acct.Acct) == "" && strings.TrimSpace(acct.Username) == "" {
			continue
		}

		bio := mastodonHTMLToText(acct.Note)

		followedBy := false
		following := false
		if rel != nil {
			followedBy = rel.FollowedBy
			following = rel.Following
		}

		mutualAccounts := familiarMap[acct.ID]
		mutualCount := len(mutualAccounts)
		mutuals := make([]GrowthMutualProfile, 0, 3)
		for i := 0; i < len(mutualAccounts) && len(mutuals) < 3; i++ {
			ma := mutualAccounts[i]
			if ma.ID == "" {
				continue
			}
			handle := ma.Acct
			if handle == "" {
				handle = ma.Username
			}
			mutuals = append(mutuals, GrowthMutualProfile{
				RemoteID:    ma.ID,
				Handle:      handle,
				DisplayName: ma.DisplayName,
				AvatarURL:   firstNonEmptyString(ma.Avatar, ma.AvatarStatic),
			})
		}

		signals := p.suggestion.signals()
		// Ensure signals slice is not nil for deterministic JSON
		if signals == nil {
			signals = []string{}
		}

		profileURL := acct.URL
		handle := acct.Acct
		if handle == "" {
			handle = acct.Username
		}

		candidates = append(candidates, GrowthCandidate{
			RemoteID:       acct.ID,
			Handle:         handle,
			DisplayName:    acct.DisplayName,
			Bio:            bio,
			AvatarURL:      firstNonEmptyString(acct.Avatar, acct.AvatarStatic),
			ProfileURL:     profileURL,
			FollowersCount: acct.FollowersCount,
			FollowingCount: acct.FollowingCount,
			MutualCount:    mutualCount,
			Mutuals:        mutuals,
			MutualsExact:   false,
			FollowedBy:     followedBy,
			Following:      following,
			Signals:        signals,
		})
	}

	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}

func (m *MastodonAdapter) FollowGrowthCandidate(ctx context.Context, accessToken, viewerID, candidateID string) (GrowthFollowResult, error) {
	if strings.TrimSpace(accessToken) == "" {
		return GrowthFollowResult{}, fmt.Errorf("mastodon follow requires an access token")
	}
	if strings.TrimSpace(candidateID) == "" {
		return GrowthFollowResult{}, fmt.Errorf("mastodon follow requires a candidate id")
	}
	// viewerID is accepted for the uniform seam but not needed for the request
	_ = viewerID

	endpoint := m.instanceURL + "/api/v1/accounts/" + url.PathEscape(candidateID) + "/follow"
	respBody, err := DoRequest(ctx, http.MethodPost, endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return GrowthFollowResult{}, err
	}
	var rel mastodonRelationship
	if err := json.Unmarshal(respBody, &rel); err != nil {
		return GrowthFollowResult{}, fmt.Errorf("decoding mastodon follow: %w", err)
	}
	state := "following"
	if rel.Requested {
		state = "requested"
	} else if rel.Following {
		state = "following"
	}
	return GrowthFollowResult{
		ProviderState:     state,
		ProviderReference: rel.ID,
	}, nil
}

func (m *MastodonAdapter) fetchMastodonSuggestions(ctx context.Context, accessToken string) ([]mastodonSuggestion, error) {
	endpoint := m.instanceURL + "/api/v2/suggestions?limit=" + fmt.Sprint(mastodonSuggestionsLimit)
	respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("mastodon suggestions: %w", err)
	}
	var suggestions []mastodonSuggestion
	if err := json.Unmarshal(respBody, &suggestions); err != nil {
		return nil, fmt.Errorf("decoding mastodon suggestions: %w", err)
	}
	return suggestions, nil
}

func (m *MastodonAdapter) fetchMastodonFamiliarFollowers(ctx context.Context, accessToken string, ids []string) (map[string][]mastodonGrowthAccount, error) {
	if len(ids) == 0 {
		return map[string][]mastodonGrowthAccount{}, nil
	}
	result := make(map[string][]mastodonGrowthAccount)
	for i := 0; i < len(ids); i += mastodonFamiliarBatchSize {
		end := i + mastodonFamiliarBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]
		params := url.Values{}
		for _, id := range batch {
			params.Add("id[]", id)
		}
		endpoint := m.instanceURL + "/api/v1/accounts/familiar_followers?" + params.Encode()
		respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return nil, fmt.Errorf("mastodon familiar_followers: %w", err)
		}
		var entries []mastodonFamiliarFollowersEntry
		if err := json.Unmarshal(respBody, &entries); err != nil {
			return nil, fmt.Errorf("decoding mastodon familiar_followers: %w", err)
		}
		for _, e := range entries {
			if e.ID == "" {
				continue
			}
			result[e.ID] = e.Accounts
		}
		// For IDs with no entry, ensure empty slice (no mutuals)
		for _, id := range batch {
			if _, ok := result[id]; !ok {
				result[id] = nil
			}
		}
	}
	return result, nil
}

func (m *MastodonAdapter) fetchMastodonRelationships(ctx context.Context, accessToken string, ids []string) (map[string]*mastodonRelationship, error) {
	if len(ids) == 0 {
		return map[string]*mastodonRelationship{}, nil
	}
	result := make(map[string]*mastodonRelationship)
	for i := 0; i < len(ids); i += mastodonRelationshipsBatchSize {
		end := i + mastodonRelationshipsBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]
		params := url.Values{}
		for _, id := range batch {
			params.Add("id[]", id)
		}
		endpoint := m.instanceURL + "/api/v1/accounts/relationships?" + params.Encode()
		respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return nil, fmt.Errorf("mastodon relationships: %w", err)
		}
		var rels []mastodonRelationship
		if err := json.Unmarshal(respBody, &rels); err != nil {
			return nil, fmt.Errorf("decoding mastodon relationships: %w", err)
		}
		for _, r := range rels {
			cp := r
			result[cp.ID] = &cp
		}
	}
	return result, nil
}

//nolint:gocyclo
func mastodonHTMLToText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	doc, err := html.Parse(strings.NewReader(s))
	if err != nil {
		// Fallback: strip tags via simple replacement
		return strings.TrimSpace(stripHTMLTags(s))
	}
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		switch n.Type {
		case html.TextNode:
			sb.WriteString(n.Data)
		case html.ElementNode:
			tag := strings.ToLower(n.Data)
			if tag == "br" {
				sb.WriteString("\n")
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
			if tag == "p" || tag == "div" || tag == "h1" || tag == "h2" || tag == "h3" || tag == "li" || tag == "tr" {
				sb.WriteString("\n")
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	text := sb.String()
	// Decode entities already handled by html parser? Text nodes are decoded.
	// Collapse excessive whitespace but preserve line breaks.
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(line)
	}
	// Remove empty lines collapse to single break, then rejoin
	var cleaned []string
	for _, line := range lines {
		if line == "" {
			continue
		}
		cleaned = append(cleaned, line)
	}
	text = strings.Join(cleaned, "\n")
	// Collapse multiple spaces
	text = strings.Join(strings.Fields(text), " ")
	return strings.TrimSpace(text)
}

func stripHTMLTags(s string) string {
	var sb strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			sb.WriteRune(r)
		}
	}
	return html.UnescapeString(sb.String())
}
