package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var xAccountContentIDPattern = regexp.MustCompile(`^[0-9]{1,32}$`)

type xAccountContentResponse struct {
	Data []struct {
		ID             string `json:"id"`
		Text           string `json:"text"`
		CreatedAt      string `json:"created_at"`
		ConversationID string `json:"conversation_id"`
	} `json:"data"`
	Meta struct {
		NextToken string `json:"next_token"`
	} `json:"meta"`
}

func (x *XAdapter) AccountContentDiscoverySupport(AnalyticsAccountContext) AccountContentDiscoverySupport {
	return AccountContentDiscoverySupport{
		Supported:   true,
		MaxPageSize: AccountContentMaxPageSize,
	}
}

func (x *XAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "missing_account_id", 0)
	}
	pageSize := min(max(1, input.PageSize), AccountContentMaxPageSize)
	params := url.Values{
		"max_results":  {strconv.Itoa(pageSize)},
		"tweet.fields": {"conversation_id,created_at,text"},
	}
	if cursor := strings.TrimSpace(input.Cursor); cursor != "" {
		params.Set("pagination_token", cursor)
	}
	if !input.PublishedAfter.IsZero() {
		params.Set("start_time", input.PublishedAfter.UTC().Format(time.RFC3339))
	}
	endpoint := x.apiURL("/2/users/"+url.PathEscape(accountID)+"/tweets") + "?" + params.Encode()
	body, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return AccountContentPage{}, fmt.Errorf("x account posts: %w", err)
	}
	var response xAccountContentResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return AccountContentPage{}, fmt.Errorf("decoding X account posts: %w", err)
	}
	return xAccountContentPage(response, input), nil
}

func xAccountContentPage(response xAccountContentResponse, input AccountContentDiscoveryRequest) AccountContentPage {
	page := AccountContentPage{Coverage: AccountContentCoverage{
		Status:      AccountContentDiscoveryComplete,
		Description: "Posts in the requested X account history window are complete.",
	}}
	seen := make(map[string]struct{}, len(response.Data))
	for _, post := range response.Data {
		id := strings.TrimSpace(post.ID)
		if !xAccountContentIDPattern.MatchString(id) {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		publishedAt, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(post.CreatedAt))
		if parseErr != nil || (!input.PublishedAfter.IsZero() && publishedAt.Before(input.PublishedAfter)) {
			continue
		}
		item, normalizeErr := NormalizeAccountContentItem(providerX, AccountContentItem{
			ProviderContentID: id,
			ProviderParentID:  strings.TrimSpace(post.ConversationID),
			ContentProfile:    "short_text",
			Text:              post.Text,
			ExternalURL:       "https://x.com/i/web/status/" + id,
			PublishedAt:       publishedAt,
			Origin:            AccountContentOriginExternal,
			OriginConfidence:  AccountContentOriginConfidenceExact,
		})
		if normalizeErr != nil {
			continue
		}
		seen[id] = struct{}{}
		page.Items = append(page.Items, item)
		if page.BackfillWatermark.IsZero() || item.PublishedAt.Before(page.BackfillWatermark) {
			page.BackfillWatermark = item.PublishedAt
		}
	}
	next := strings.TrimSpace(response.Meta.NextToken)
	if next != "" && next != strings.TrimSpace(input.Cursor) {
		page.NextCursor = next
		page.Coverage.Status = AccountContentDiscoveryPartial
		page.Coverage.Description = "More X posts remain in the requested account history window."
	}
	return page
}
