package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const metaAccountContentPageSize = 100

var metaContentIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,500}$`)

type metaDiscoveryPaging struct {
	Cursors struct {
		After string `json:"after"`
	} `json:"cursors"`
	Next string `json:"next"`
}

type metaDiscoveryProviderError struct {
	Code int `json:"code"`
}

type metaDiscoveryResponse[T any] struct {
	Data   []T                        `json:"data"`
	Paging metaDiscoveryPaging        `json:"paging"`
	Error  metaDiscoveryProviderError `json:"error"`
}

type metaDiscoveryItem struct {
	ID               string `json:"id"`
	Caption          string `json:"caption"`
	Message          string `json:"message"`
	Text             string `json:"text"`
	MediaType        string `json:"media_type"`
	MediaProductType string `json:"media_product_type"`
	Permalink        string `json:"permalink"`
	PermalinkURL     string `json:"permalink_url"`
	Timestamp        string `json:"timestamp"`
	CreatedTime      string `json:"created_time"`
	Attachments      struct {
		Data []struct {
			MediaType      string `json:"media_type"`
			Type           string `json:"type"`
			Subattachments struct {
				Data []json.RawMessage `json:"data"`
			} `json:"subattachments"`
		} `json:"data"`
	} `json:"attachments"`
}

func (f *FacebookAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	if strings.TrimSpace(input.AccountID) == "" {
		return AccountContentDiscoverySupport{UnavailableReason: "Facebook Page discovery requires a selected Page."}
	}
	return AccountContentDiscoverySupport{
		Supported: true, RequiredScopes: []string{"pages_read_engagement"}, MaxPageSize: metaAccountContentPageSize,
	}
}

func (i *InstagramAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	if strings.TrimSpace(input.AccountID) == "" {
		return AccountContentDiscoverySupport{UnavailableReason: "Instagram discovery requires a selected professional account."}
	}
	accountType := strings.ToLower(strings.TrimSpace(input.CapabilityState["instagram_account_type"]))
	if accountType == "personal" || accountType == "consumer" {
		return AccountContentDiscoverySupport{UnavailableReason: "Instagram history is available only for professional accounts."}
	}
	return AccountContentDiscoverySupport{
		Supported: true, RequiredScopes: []string{"instagram_basic"}, MaxPageSize: metaAccountContentPageSize,
	}
}

func (t *ThreadsAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	if strings.TrimSpace(input.AccountID) == "" {
		return AccountContentDiscoverySupport{UnavailableReason: "Threads discovery requires a selected profile."}
	}
	return AccountContentDiscoverySupport{
		Supported: true, RequiredScopes: []string{"threads_basic"}, MaxPageSize: metaAccountContentPageSize,
	}
}

func (f *FacebookAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	if err := validateMetaDiscoveryRequest(accessToken, input, "pages_read_engagement"); err != nil {
		return AccountContentPage{}, err
	}
	query, err := metaDiscoveryQuery(input, "id,message,created_time,permalink_url,attachments.limit(1){media_type,type,subattachments.limit(2)}")
	if err != nil {
		return AccountContentPage{}, err
	}
	return discoverMetaAccountContent(ctx, f.graphURL(url.PathEscape(strings.TrimSpace(input.AccountID))+"/published_posts")+"?"+query.Encode(), accessToken, input, "Facebook Page posts", facebookDiscoveryItem)
}

func (i *InstagramAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	if err := validateMetaDiscoveryRequest(accessToken, input, "instagram_basic"); err != nil {
		return AccountContentPage{}, err
	}
	query, err := metaDiscoveryQuery(input, "id,caption,media_type,media_product_type,permalink,timestamp")
	if err != nil {
		return AccountContentPage{}, err
	}
	return discoverMetaAccountContent(ctx, i.graphURL(url.PathEscape(strings.TrimSpace(input.AccountID))+"/media")+"?"+query.Encode(), accessToken, input, "Instagram media", instagramDiscoveryItem)
}

func (t *ThreadsAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	if err := validateMetaDiscoveryRequest(accessToken, input, "threads_basic"); err != nil {
		return AccountContentPage{}, err
	}
	query, err := metaDiscoveryQuery(input, "id,text,media_type,media_product_type,permalink,timestamp")
	if err != nil {
		return AccountContentPage{}, err
	}
	endpoint := "https://graph.threads.net/v1.0/" + url.PathEscape(strings.TrimSpace(input.AccountID)) + "/threads?" + query.Encode()
	return discoverMetaAccountContent(ctx, endpoint, accessToken, input, "Threads posts", threadsDiscoveryItem)
}

func validateMetaDiscoveryRequest(accessToken string, input AccountContentDiscoveryRequest, requiredScope string) error {
	if strings.TrimSpace(accessToken) == "" {
		return NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, "missing_access_token", 0)
	}
	if strings.TrimSpace(input.AccountID) == "" {
		return NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "missing_account_id", 0)
	}
	if missing := MissingAnalyticsScopes(strings.Join(input.GrantedScopes, " "), []string{requiredScope}); len(missing) > 0 {
		return NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, "missing_scope", 0)
	}
	return nil
}

func metaDiscoveryQuery(input AccountContentDiscoveryRequest, fields string) (url.Values, error) {
	cursor := strings.TrimSpace(input.Cursor)
	if len(cursor) > 1500 || strings.IndexFunc(cursor, unicode.IsControl) >= 0 {
		return nil, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	pageSize := min(max(1, input.PageSize), metaAccountContentPageSize)
	query := url.Values{"fields": {fields}, "limit": {strconv.Itoa(pageSize)}}
	if cursor != "" {
		query.Set("after", cursor)
	}
	return query, nil
}

type metaDiscoveryMapper func(metaDiscoveryItem, string) (AccountContentItem, bool, error)

func discoverMetaAccountContent(
	ctx context.Context,
	endpoint string,
	accessToken string,
	input AccountContentDiscoveryRequest,
	label string,
	mapper metaDiscoveryMapper,
) (AccountContentPage, error) {
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
	if err != nil {
		return AccountContentPage{}, normalizeMetaDiscoveryError(err)
	}
	var response metaDiscoveryResponse[metaDiscoveryItem]
	if err := json.Unmarshal(body, &response); err != nil {
		return AccountContentPage{}, fmt.Errorf("decoding %s: %w", label, err)
	}
	if response.Error.Code != 0 && len(response.Data) == 0 {
		return AccountContentPage{}, metaDiscoveryCodeError(response.Error.Code)
	}
	pageSize := min(max(1, input.PageSize), metaAccountContentPageSize)
	if len(response.Data) > pageSize {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "provider_page_too_large", 0)
	}

	page, itemPartial, reachedLowerBound := mapMetaDiscoveryItems(response.Data, input, mapper)
	nextCursor, err := metaDiscoveryNextCursor(response.Paging, input.Cursor, reachedLowerBound)
	if err != nil {
		return AccountContentPage{}, err
	}
	page.NextCursor = nextCursor
	page.Coverage = metaDiscoveryCoverage(label, page.NextCursor != "", response.Error.Code != 0 || itemPartial)
	return page, nil
}

func mapMetaDiscoveryItems(items []metaDiscoveryItem, input AccountContentDiscoveryRequest, mapper metaDiscoveryMapper) (AccountContentPage, bool, bool) {
	page := AccountContentPage{}
	partial := false
	reachedLowerBound := false
	seen := make(map[string]struct{}, len(items))
	for _, raw := range items {
		item, itemPartial, mapErr := mapper(raw, input.AccountID)
		if mapErr != nil {
			partial = true
			continue
		}
		if !input.PublishedAfter.IsZero() && item.PublishedAt.Before(input.PublishedAfter) {
			reachedLowerBound = true
			continue
		}
		if _, duplicate := seen[item.ProviderContentID]; duplicate {
			continue
		}
		seen[item.ProviderContentID] = struct{}{}
		partial = partial || itemPartial
		page.Items = append(page.Items, item)
		if page.BackfillWatermark.IsZero() || item.PublishedAt.Before(page.BackfillWatermark) {
			page.BackfillWatermark = item.PublishedAt
		}
	}
	return page, partial, reachedLowerBound
}

func metaDiscoveryNextCursor(paging metaDiscoveryPaging, currentCursor string, reachedLowerBound bool) (string, error) {
	if reachedLowerBound {
		return "", nil
	}
	nextCursor := strings.TrimSpace(paging.Cursors.After)
	if strings.TrimSpace(paging.Next) != "" && nextCursor == "" {
		return "", NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "missing_paging_cursor", 0)
	}
	if nextCursor == strings.TrimSpace(currentCursor) && nextCursor != "" {
		return "", NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "repeated_cursor", 0)
	}
	return nextCursor, nil
}

func metaDiscoveryCoverage(label string, hasNext, partial bool) AccountContentCoverage {
	coverage := AccountContentCoverage{
		Status: AccountContentDiscoveryComplete, Description: label + " in the requested history window are complete.",
	}
	if hasNext {
		coverage.Status = AccountContentDiscoveryPartial
		coverage.Description = "More " + label + " remain within the requested history window."
	}
	if partial {
		coverage.Status = AccountContentDiscoveryPartial
		coverage.Description = strings.TrimSpace(coverage.Description + " Some content fields or items were unavailable and were omitted safely.")
	}
	return coverage
}

func facebookDiscoveryItem(raw metaDiscoveryItem, accountID string) (AccountContentItem, bool, error) {
	profile, profilePartial := facebookDiscoveryProfile(raw)
	return normalizeMetaDiscoveryItem(providerFacebook, raw.ID, accountID, profile, raw.Message, raw.PermalinkURL, raw.CreatedTime, profilePartial)
}

func instagramDiscoveryItem(raw metaDiscoveryItem, accountID string) (AccountContentItem, bool, error) {
	profile, profilePartial := instagramDiscoveryProfile(raw.MediaType, raw.MediaProductType)
	return normalizeMetaDiscoveryItem(providerInstagram, raw.ID, accountID, profile, raw.Caption, raw.Permalink, raw.Timestamp, profilePartial)
}

func threadsDiscoveryItem(raw metaDiscoveryItem, accountID string) (AccountContentItem, bool, error) {
	profile, profilePartial := threadsDiscoveryProfile(raw.MediaType)
	return normalizeMetaDiscoveryItem(providerThreads, raw.ID, accountID, profile, raw.Text, raw.Permalink, raw.Timestamp, profilePartial)
}

func normalizeMetaDiscoveryItem(provider, id, parentID, profile, text, permalink, timestamp string, partial bool) (AccountContentItem, bool, error) {
	id = strings.TrimSpace(id)
	if !metaContentIDPattern.MatchString(id) {
		return AccountContentItem{}, true, fmt.Errorf("invalid Meta content ID")
	}
	publishedAt, err := parseMetaDiscoveryTime(timestamp)
	if err != nil {
		return AccountContentItem{}, true, err
	}
	permalink = strings.TrimSpace(permalink)
	if permalink != "" && !IsSafeProviderContentURL(provider, permalink) {
		permalink = ""
		partial = true
	}
	item, err := NormalizeAccountContentItem(provider, AccountContentItem{
		ProviderContentID: id,
		ProviderParentID:  strings.TrimSpace(parentID),
		ContentProfile:    profile,
		Text:              text,
		ExternalURL:       permalink,
		PublishedAt:       publishedAt,
		Origin:            AccountContentOriginExternal,
		OriginConfidence:  AccountContentOriginConfidenceExact,
	})
	return item, partial, err
}

func facebookDiscoveryProfile(raw metaDiscoveryItem) (string, bool) {
	if len(raw.Attachments.Data) == 0 {
		return "short_text", false
	}
	attachment := raw.Attachments.Data[0]
	kind := strings.ToLower(firstNonEmptyString(attachment.Type, attachment.MediaType))
	if len(attachment.Subattachments.Data) > 1 || strings.Contains(kind, "album") || strings.Contains(kind, "multi") {
		return "carousel", false
	}
	switch {
	case strings.Contains(kind, "photo"), strings.Contains(kind, "image"):
		return "image_post", false
	case strings.Contains(kind, "video"):
		return "short_video", false
	case strings.Contains(kind, "link"), strings.Contains(kind, "share"):
		return "link_share", false
	default:
		return "short_text", true
	}
}

func instagramDiscoveryProfile(mediaType, productType string) (string, bool) {
	mediaType = strings.ToUpper(strings.TrimSpace(mediaType))
	productType = strings.ToUpper(strings.TrimSpace(productType))
	switch {
	case mediaType == "CAROUSEL_ALBUM":
		return "carousel", false
	case mediaType == "IMAGE":
		return "image_post", false
	case mediaType == "VIDEO" || productType == "REELS":
		return "short_video", false
	default:
		return "short_text", true
	}
}

func threadsDiscoveryProfile(mediaType string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(mediaType)) {
	case "TEXT_POST", "TEXT":
		return "short_text", false
	case "IMAGE":
		return "image_post", false
	case "VIDEO":
		return "short_video", false
	case "CAROUSEL_ALBUM", "CAROUSEL":
		return "carousel", false
	default:
		return "short_text", true
	}
}

func parseMetaDiscoveryTime(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05-0700"} {
		if parsed, err := time.Parse(layout, raw); err == nil && !parsed.IsZero() {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("meta content has no valid publish time")
}

func normalizeMetaDiscoveryError(err error) error {
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) {
		return err
	}
	code, parseErr := strconv.Atoi(providerErr.Code)
	if parseErr == nil {
		classified := metaDiscoveryCodeError(code)
		var discoveryErr *AccountContentDiscoveryError
		if errors.As(classified, &discoveryErr) {
			discoveryErr.RetryAfter = providerErr.RetryAfter
		}
		return classified
	}
	switch providerErr.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, firstNonEmptyString(providerErr.Code, "permission_denied"), providerErr.RetryAfter)
	case http.StatusTooManyRequests:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryRateLimited, firstNonEmptyString(providerErr.Code, "rate_limited"), providerErr.RetryAfter)
	default:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, firstNonEmptyString(providerErr.Code, "provider_request_failed"), providerErr.RetryAfter)
	}
}

func metaDiscoveryCodeError(code int) error {
	stableCode := "meta:" + strconv.Itoa(code)
	switch code {
	case 10, 190, 200:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, stableCode, 0)
	case 4, 17, 80001, 80002:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryRateLimited, stableCode, 0)
	default:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, stableCode, 0)
	}
}
