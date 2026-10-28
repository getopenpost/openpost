package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/openpost/backend/internal/inboxactivity"
)

func (t *ThreadsAdapter) AccountActivitySupport() []AccountActivitySupport {
	return []AccountActivitySupport{{Feed: "mentions", RequiredScopes: []string{"threads_manage_mentions"}}}
}

func (t *ThreadsAdapter) ListAccountActivity(ctx context.Context, token, _ string, input AccountActivityRequest) (AccountActivityPage, error) {
	if err := validateActivityRequest(input, "mentions"); err != nil {
		return AccountActivityPage{}, err
	}
	query := url.Values{"fields": {"id,text,username,timestamp,permalink"}, "limit": {"50"}}
	if input.Cursor != "" {
		query.Set("after", input.Cursor)
	}
	data, err := doMetaRequest(ctx, http.MethodGet, "https://graph.threads.net/v1.0/me/mentions?"+query.Encode(), nil, bearerHeaders(token))
	if err != nil {
		return AccountActivityPage{}, err
	}
	var response struct {
		Data   []struct{ ID, Text, Username, Timestamp, Permalink string } `json:"data"`
		Paging struct {
			Next    string `json:"next"`
			Cursors struct {
				After string `json:"after"`
			} `json:"cursors"`
		} `json:"paging"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return AccountActivityPage{}, fmt.Errorf("decode Threads mentions: %w", err)
	}
	if response.Data == nil || len(response.Data) > 50 {
		return AccountActivityPage{}, fmt.Errorf("invalid Threads mention page")
	}
	page := AccountActivityPage{}
	if response.Paging.Next != "" {
		if response.Paging.Cursors.After == "" {
			return page, fmt.Errorf("threads mention continuation is missing")
		}
		page.NextCursor = response.Paging.Cursors.After
	}
	for _, post := range response.Data {
		if post.ID == "" {
			return AccountActivityPage{}, fmt.Errorf("threads mention identity is missing")
		}
		observed := ProviderTime(post.Timestamp)
		page.Items = append(page.Items, AccountActivityItem{Kind: "mention", ObservedAt: observed,
			Comment: Comment{ID: post.ID, ConversationID: post.ID, AuthorHandle: prefixHandle(post.Username), Text: post.Text, CreatedAt: post.Timestamp, CanReply: true},
			Subject: inboxactivity.EngagementSubject{Kind: "post", RemoteID: post.ID, URL: post.Permalink}})
	}
	return page, validateActivityCursor(page.NextCursor)
}
