package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const blueskyAccountContentPageSize = 100

type blueskyAccountContentCursor struct {
	PDSURL string `json:"pds_url"`
	Repo   string `json:"repo"`
	Cursor string `json:"cursor"`
}

type blueskyAuthorFeedResponse struct {
	Cursor string `json:"cursor"`
	Feed   []struct {
		Post struct {
			URI    string `json:"uri"`
			Author struct {
				DID string `json:"did"`
			} `json:"author"`
			Record struct {
				Type      string `json:"$type"`
				Text      string `json:"text"`
				CreatedAt string `json:"createdAt"`
				Reply     struct {
					Parent struct {
						URI string `json:"uri"`
					} `json:"parent"`
				} `json:"reply"`
				Embed struct {
					Type  string `json:"$type"`
					Media struct {
						Type string `json:"$type"`
					} `json:"media"`
				} `json:"embed"`
			} `json:"record"`
		} `json:"post"`
	} `json:"feed"`
}

func (b *BlueskyAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	accountID := strings.TrimSpace(input.AccountID)
	if !strings.HasPrefix(accountID, "did:") {
		return AccountContentDiscoverySupport{UnavailableReason: "Bluesky account content discovery requires a DID repository identity."}
	}
	if _, ok := canonicalProviderServerURL(b.pdsURL); !ok {
		return AccountContentDiscoverySupport{UnavailableReason: "Bluesky account content discovery is unavailable for this PDS configuration."}
	}
	return AccountContentDiscoverySupport{Supported: true, MaxPageSize: blueskyAccountContentPageSize}
}

func (b *BlueskyAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	if strings.TrimSpace(accessToken) == "" {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, "authentication_required", 0)
	}
	repo := strings.TrimSpace(input.AccountID)
	if !strings.HasPrefix(repo, "did:") {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, "invalid_repository", 0)
	}
	pdsURL, ok := canonicalProviderServerURL(b.pdsURL)
	if !ok {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, "invalid_pds", 0)
	}
	cursor, err := decodeBlueskyAccountContentCursor(input.Cursor, pdsURL, repo)
	if err != nil {
		return AccountContentPage{}, err
	}
	pageSize := min(max(1, input.PageSize), blueskyAccountContentPageSize)
	params := url.Values{
		"actor":       {repo},
		"filter":      {"posts_with_replies"},
		"includePins": {"false"},
		"limit":       {fmt.Sprint(pageSize)},
	}
	if cursor.Cursor != "" {
		params.Set("cursor", cursor.Cursor)
	}
	body, err := DoRequest(ctx, http.MethodGet, pdsURL+"/xrpc/app.bsky.feed.getAuthorFeed?"+params.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return AccountContentPage{}, socialAccountContentDiscoveryError(err)
	}
	var response blueskyAuthorFeedResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return AccountContentPage{}, fmt.Errorf("decoding bluesky author feed: %w", err)
	}
	return blueskyAccountContentPage(response, pdsURL, repo, cursor.Cursor, input.PublishedAfter)
}

//nolint:gocyclo // One bounded page owns repository, time, identity, profile, deduplication, and cursor validation.
func blueskyAccountContentPage(response blueskyAuthorFeedResponse, pdsURL, repo, currentCursor string, publishedAfter time.Time) (AccountContentPage, error) {
	page := AccountContentPage{Coverage: AccountContentCoverage{
		Status:      AccountContentDiscoveryPartial,
		Description: "Authenticated discovery includes public Bluesky posts returned by this AppView; provider indexing and feed caps may omit history.",
	}}
	seen := make(map[string]struct{}, len(response.Feed))
	reachedLowerBound := false
	for _, entry := range response.Feed {
		post := entry.Post
		uriRepo, _, recordKey, ok := parseBlueskyPostURI(strings.TrimSpace(post.URI))
		if !ok || uriRepo != repo || (post.Author.DID != "" && strings.TrimSpace(post.Author.DID) != repo) {
			continue
		}
		publishedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(post.Record.CreatedAt))
		if err != nil || publishedAt.IsZero() {
			continue
		}
		publishedAt = publishedAt.UTC()
		if !publishedAfter.IsZero() && publishedAt.Before(publishedAfter) {
			reachedLowerBound = true
			continue
		}
		identity, ok := CanonicalSocialAccountContentID(providerBluesky, pdsURL, repo, post.URI)
		if !ok {
			continue
		}
		if _, duplicate := seen[identity]; duplicate {
			continue
		}
		seen[identity] = struct{}{}
		item := AccountContentItem{
			ProviderContentID: identity,
			ContentProfile:    blueskyAccountContentProfile(post.Record.Embed.Type, post.Record.Embed.Media.Type),
			Text:              post.Record.Text,
			ExternalURL:       "https://bsky.app/profile/" + url.PathEscape(repo) + "/post/" + url.PathEscape(recordKey),
			PublishedAt:       publishedAt,
			Origin:            AccountContentOriginExternal,
			OriginConfidence:  AccountContentOriginConfidenceExact,
		}
		if post.Record.Reply.Parent.URI != "" {
			item.ProviderParentID, _ = CanonicalSocialAccountContentID(providerBluesky, pdsURL, "", post.Record.Reply.Parent.URI)
		}
		normalized, err := NormalizeAccountContentItem(providerBluesky, item)
		if err != nil {
			continue
		}
		page.Items = append(page.Items, normalized)
		if page.BackfillWatermark.IsZero() || publishedAt.Before(page.BackfillWatermark) {
			page.BackfillWatermark = publishedAt
		}
	}
	providerCursor := strings.TrimSpace(response.Cursor)
	if reachedLowerBound || providerCursor == "" || providerCursor == currentCursor {
		return page, nil
	}
	if len(providerCursor) > 1000 {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "oversized_cursor", 0)
	}
	nextCursor, err := encodeBlueskyAccountContentCursor(blueskyAccountContentCursor{PDSURL: pdsURL, Repo: repo, Cursor: providerCursor})
	if err != nil {
		return AccountContentPage{}, err
	}
	page.NextCursor = nextCursor
	return page, nil
}

func blueskyAccountContentProfile(embedType, mediaType string) string {
	kind := firstNonEmptyString(mediaType, embedType)
	switch {
	case strings.Contains(kind, "images"):
		return "image_post"
	case strings.Contains(kind, "video"):
		return "short_video"
	case strings.Contains(kind, "external"):
		return "link_share"
	default:
		return "short_text"
	}
}

func encodeBlueskyAccountContentCursor(cursor blueskyAccountContentCursor) (string, error) {
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", fmt.Errorf("encoding bluesky discovery cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func decodeBlueskyAccountContentCursor(raw, pdsURL, repo string) (blueskyAccountContentCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return blueskyAccountContentCursor{PDSURL: pdsURL, Repo: repo}, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return blueskyAccountContentCursor{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	var cursor blueskyAccountContentCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.PDSURL != pdsURL || cursor.Repo != repo || strings.TrimSpace(cursor.Cursor) == "" {
		return blueskyAccountContentCursor{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	return cursor, nil
}
