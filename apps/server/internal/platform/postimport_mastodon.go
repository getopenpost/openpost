package platform

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type mastodonNativeStatus struct {
	ID        string `json:"id"`
	CreatedAt string `json:"created_at"`
	Content   string `json:"content"`
	Spoiler   string `json:"spoiler_text"`
	URL       string `json:"url"`
	Reblog    *struct {
		ID string `json:"id"`
	} `json:"reblog"`
	InReplyToID string `json:"in_reply_to_id"`
	Account     struct {
		ID string `json:"id"`
	} `json:"account"`
}

// NativePostSupport declares Mastodon native-read support.
func (m *MastodonAdapter) NativePostSupport() NativePostSupport {
	return NativePostSupport{Supported: true, MinPageSize: 1, MaxPageSize: NativePostMaxPageSize}
}

// ListNativePosts reads the connected account's own Mastodon statuses.
// Server-side exclude_replies and exclude_reblogs keep the read to originals;
// the account-ID check below is the defense in depth. One read per page.
func (m *MastodonAdapter) ListNativePosts(ctx context.Context, accessToken string, input NativePostRequest) (NativePostPage, error) {
	accountID := strings.TrimSpace(input.AccountID)
	instanceURL := strings.TrimRight(strings.TrimSpace(input.InstanceURL), "/")
	if accountID == "" || instanceURL == "" {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "missing_account_or_instance", 0)
	}
	pageSize := nativePostPageSize(input, m.NativePostSupport())
	params := url.Values{
		"exclude_replies": {"true"},
		"exclude_reblogs": {"true"},
		"limit":           {strconv.Itoa(pageSize)},
	}
	if cursor := strings.TrimSpace(input.Cursor); cursor != "" {
		params.Set("max_id", cursor)
	}
	endpoint := nativePostEndpoint(instanceURL, "/api/v1/accounts/"+url.PathEscape(accountID)+"/statuses", params)
	statuses, err := DoBearerJSON[[]mastodonNativeStatus](ctx, "GET", endpoint, accessToken, nil, "mastodon account statuses")
	if err != nil {
		return NativePostPage{}, classifyNativePostError(err)
	}
	if statuses == nil {
		return NativePostPage{Coverage: NativePostComplete}, nil
	}
	return nativePostMastodonPage(*statuses, input), nil
}

func nativePostMastodonPage(statuses []mastodonNativeStatus, input NativePostRequest) NativePostPage {
	page := NativePostPage{Coverage: NativePostComplete}
	accountID := strings.TrimSpace(input.AccountID)
	seen := make(map[string]struct{}, len(statuses))
	var oldest string
	for _, status := range statuses {
		id := strings.TrimSpace(status.ID)
		if id == "" {
			continue
		}
		oldest = id
		// Boosts and replies are never imported, even if an instance ignores
		// the exclusion parameters.
		if status.Reblog != nil || strings.TrimSpace(status.InReplyToID) != "" {
			continue
		}
		if strings.TrimSpace(status.Account.ID) != accountID {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		publishedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(status.CreatedAt))
		if err != nil {
			continue
		}
		publishedAt = publishedAt.UTC()
		if !input.PublishedAfter.IsZero() && publishedAt.Before(input.PublishedAfter) {
			// Statuses are reverse-chronological: everything older than the
			// import watermark ends the window.
			page.Coverage = NativePostComplete
			page.NextCursor = ""
			return page
		}
		text := strings.TrimSpace(stripHTMLTags(status.Content))
		if spoiler := strings.TrimSpace(status.Spoiler); spoiler != "" {
			text = strings.TrimSpace(spoiler + "\n\n" + text)
		}
		item, normalizeErr := NormalizeNativePostItem(NativePostItem{
			ProviderPostID: id,
			Text:           text,
			ExternalURL:    strings.TrimSpace(status.URL),
			PublishedAt:    publishedAt,
			Origin:         ImportedPostOriginExternal,
		})
		if normalizeErr != nil {
			continue
		}
		seen[id] = struct{}{}
		page.Items = append(page.Items, item)
	}
	// Mastodon paginates with max_id; the oldest ID seen is the next cursor.
	// A short page means the account history is exhausted.
	if oldest != "" && len(statuses) >= nativePostPageSize(input, NativePostSupport{MinPageSize: 1, MaxPageSize: NativePostMaxPageSize}) && oldest != strings.TrimSpace(input.Cursor) {
		page.NextCursor = oldest
		page.Coverage = NativePostPartial
	}
	return page
}
