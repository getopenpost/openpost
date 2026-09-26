package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type blueskyAuthorFeedResponse struct {
	Cursor string `json:"cursor"`
	Feed   []struct {
		Post struct {
			URI    string `json:"uri"`
			Author struct {
				DID    string `json:"did"`
				Handle string `json:"handle"`
			} `json:"author"`
			Record struct {
				Text      string `json:"text"`
				CreatedAt string `json:"createdAt"`
			} `json:"record"`
			IndexedAt string `json:"indexedAt"`
		} `json:"post"`
		Reason json.RawMessage `json:"reason"`
		Reply  json.RawMessage `json:"reply"`
	} `json:"feed"`
}

// NativePostSupport declares Bluesky native-read support.
func (b *BlueskyAdapter) NativePostSupport() NativePostSupport {
	return NativePostSupport{Supported: true, MinPageSize: 1, MaxPageSize: NativePostMaxPageSize}
}

// ListNativePosts reads the connected account's own Bluesky posts through
// app.bsky.feed.getAuthorFeed. Only original posts (no reposts, no replies)
// by the connected DID are returned; provider calls stay at one read per page.
func (b *BlueskyAdapter) ListNativePosts(ctx context.Context, accessToken string, input NativePostRequest) (NativePostPage, error) {
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "missing_account_id", 0)
	}
	pageSize := nativePostPageSize(input, b.NativePostSupport())
	params := url.Values{
		"actor":  {accountID},
		"filter": {"posts_no_replies"},
		"limit":  {strconv.Itoa(pageSize)},
	}
	if cursor := strings.TrimSpace(input.Cursor); cursor != "" {
		params.Set("cursor", cursor)
	}
	endpoint := nativePostEndpoint(b.PDSURL(), "/xrpc/app.bsky.feed.getAuthorFeed", params)
	body, err := b.doRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	var response blueskyAuthorFeedResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "decode_response", 0)
	}
	return nativePostBlueskyPage(response, input), nil
}

func nativePostBlueskyPage(response blueskyAuthorFeedResponse, input NativePostRequest) NativePostPage {
	page := NativePostPage{Coverage: NativePostComplete}
	accountID := strings.TrimSpace(input.AccountID)
	seen := make(map[string]struct{}, len(response.Feed))
	for _, entry := range response.Feed {
		// Reposts carry a reason; replies carry a reply reference even under
		// posts_no_replies on some PDS versions. Import originals only.
		if len(entry.Reason) > 0 || len(entry.Reply) > 0 {
			continue
		}
		if strings.TrimSpace(entry.Post.Author.DID) != accountID {
			continue
		}
		uri := strings.TrimSpace(entry.Post.URI)
		if uri == "" {
			continue
		}
		if _, duplicate := seen[uri]; duplicate {
			continue
		}
		publishedAt := parseNativePostTime(entry.Post.Record.CreatedAt, entry.Post.IndexedAt)
		if publishedAt.IsZero() {
			continue
		}
		if !input.PublishedAfter.IsZero() && publishedAt.Before(input.PublishedAfter) {
			// The feed is reverse-chronological: everything after this point
			// is older than the import watermark, so the window is complete.
			page.Coverage = NativePostComplete
			page.NextCursor = ""
			return page
		}
		handle := strings.TrimSpace(entry.Post.Author.Handle)
		profile := handle
		if profile == "" {
			profile = accountID
		}
		item, normalizeErr := NormalizeNativePostItem(NativePostItem{
			ProviderPostID: uri,
			Text:           entry.Post.Record.Text,
			ExternalURL:    blueskyNativePostURL(profile, uri),
			PublishedAt:    publishedAt,
			Origin:         ImportedPostOriginExternal,
		})
		if normalizeErr != nil {
			continue
		}
		seen[uri] = struct{}{}
		page.Items = append(page.Items, item)
	}
	if next := strings.TrimSpace(response.Cursor); next != "" && next != strings.TrimSpace(input.Cursor) && len(response.Feed) > 0 {
		page.NextCursor = next
		page.Coverage = NativePostPartial
	}
	return page
}

func blueskyNativePostURL(profile, uri string) string {
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(uri), "at://"), "/")
	if len(parts) != 3 || parts[1] != "app.bsky.feed.post" || parts[2] == "" {
		return ""
	}
	return "https://bsky.app/profile/" + profile + "/post/" + parts[2]
}

func parseNativePostTime(primary, fallback string) time.Time {
	for _, candidate := range []string{strings.TrimSpace(primary), strings.TrimSpace(fallback)} {
		if candidate == "" {
			continue
		}
		if parsed, err := time.Parse(time.RFC3339, candidate); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func classifyNativePostError(err error) error {
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		code := strings.TrimSpace(httpErr.Code)
		switch {
		case httpErr.StatusCode == http.StatusUnauthorized || httpErr.StatusCode == http.StatusForbidden:
			// Never disconnect on a native-read permission failure; the
			// import checkpoint records it and the account stays connected.
			return NewNativePostError(NativePostPermissionRequired, code, 0)
		case httpErr.StatusCode == http.StatusTooManyRequests:
			return NewNativePostError(NativePostRateLimited, code, httpErr.RetryAfter)
		case httpErr.StatusCode >= 500:
			return NewNativePostError(NativePostFailed, code, 0)
		default:
			return NewNativePostError(NativePostFailed, code, 0)
		}
	}
	lower := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lower, "rate limit") || strings.Contains(lower, "too many"):
		return NewNativePostError(NativePostRateLimited, "", 0)
	case strings.Contains(lower, "unauthorized") || strings.Contains(lower, "forbidden") || strings.Contains(lower, "token"):
		return NewNativePostError(NativePostPermissionRequired, "", 0)
	default:
		return NewNativePostError(NativePostFailed, "", 0)
	}
}
