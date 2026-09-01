package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/openpost/backend/internal/netguard"
)

const mastodonAccountContentPageSize = 40

type mastodonAccountContentCursor struct {
	InstanceURL string `json:"instance_url"`
	MaxID       string `json:"max_id"`
}

type mastodonAccountContentStatus struct {
	ID          string `json:"id"`
	URI         string `json:"uri"`
	URL         string `json:"url"`
	Content     string `json:"content"`
	CreatedAt   string `json:"created_at"`
	Visibility  string `json:"visibility"`
	InReplyToID string `json:"in_reply_to_id"`
	Account     struct {
		Username string `json:"username"`
	} `json:"account"`
	MediaAttachments []struct {
		Type string `json:"type"`
	} `json:"media_attachments"`
}

func (m *MastodonAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	if strings.TrimSpace(input.AccountID) == "" {
		return AccountContentDiscoverySupport{UnavailableReason: "Mastodon account content discovery requires a stable account identity."}
	}
	if _, ok := canonicalProviderServerURL(m.instanceURL); !ok {
		return AccountContentDiscoverySupport{UnavailableReason: "Mastodon account content discovery is unavailable for this instance configuration."}
	}
	return AccountContentDiscoverySupport{Supported: true, MaxPageSize: mastodonAccountContentPageSize}
}

func (m *MastodonAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	if strings.TrimSpace(accessToken) == "" {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, "authentication_required", 0)
	}
	if strings.TrimSpace(input.AccountID) == "" {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, "missing_account_id", 0)
	}
	instanceURL, ok := canonicalProviderServerURL(m.instanceURL)
	if !ok {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, "invalid_instance", 0)
	}
	cursor, err := decodeMastodonAccountContentCursor(input.Cursor, instanceURL)
	if err != nil {
		return AccountContentPage{}, err
	}
	pageSize := min(max(1, input.PageSize), mastodonAccountContentPageSize)
	params := url.Values{
		"exclude_reblogs": {"true"},
		"limit":           {fmt.Sprint(pageSize)},
	}
	if cursor.MaxID != "" {
		params.Set("max_id", cursor.MaxID)
	}
	endpoint := instanceURL + "/api/v1/accounts/" + url.PathEscape(strings.TrimSpace(input.AccountID)) + "/statuses?" + params.Encode()
	body, err := doRequestWithClient(ctx, mastodonDiscoveryHTTPClient(instanceURL), http.MethodGet, endpoint, nil, map[string]string{headerAuthorization: bearerPrefix + accessToken})
	if err != nil {
		return AccountContentPage{}, socialAccountContentDiscoveryError(err)
	}
	var statuses []mastodonAccountContentStatus
	if err := json.Unmarshal(body, &statuses); err != nil {
		return AccountContentPage{}, fmt.Errorf("decoding mastodon account statuses: %w", err)
	}
	return mastodonAccountContentPage(statuses, instanceURL, input.PublishedAfter, pageSize)
}

//nolint:gocyclo // One bounded page owns visibility, time, identity, URL, media-profile, and cursor validation.
func mastodonAccountContentPage(statuses []mastodonAccountContentStatus, instanceURL string, publishedAfter time.Time, pageSize int) (AccountContentPage, error) {
	page := AccountContentPage{Coverage: AccountContentCoverage{
		Status:      AccountContentDiscoveryPartial,
		Description: "Only public statuses visible through the authenticated Mastodon instance are included.",
	}}
	seen := make(map[string]struct{}, len(statuses))
	reachedLowerBound := false
	lastStatusID := ""
	for _, status := range statuses {
		statusID := strings.TrimSpace(status.ID)
		if statusID != "" {
			lastStatusID = statusID
		}
		publishedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(status.CreatedAt))
		if err != nil || publishedAt.IsZero() {
			continue
		}
		publishedAt = publishedAt.UTC()
		if !publishedAfter.IsZero() && publishedAt.Before(publishedAfter) {
			reachedLowerBound = true
			continue
		}
		if status.Visibility != "public" {
			continue
		}
		identity, ok := CanonicalSocialAccountContentID(providerMastodon, instanceURL, "", statusID)
		if !ok {
			continue
		}
		if _, duplicate := seen[identity]; duplicate {
			continue
		}
		seen[identity] = struct{}{}
		item := AccountContentItem{
			ProviderContentID: identity,
			ContentProfile:    mastodonAccountContentProfile(status.MediaAttachments),
			Text:              mastodonHTMLToText(status.Content),
			ExternalURL:       safeMastodonStatusURL(instanceURL, status),
			PublishedAt:       publishedAt,
			Origin:            AccountContentOriginExternal,
			OriginConfidence:  AccountContentOriginConfidenceExact,
		}
		if status.InReplyToID != "" {
			item.ProviderParentID, _ = CanonicalSocialAccountContentID(providerMastodon, instanceURL, "", status.InReplyToID)
		}
		normalized, err := NormalizeAccountContentItem(providerMastodon, item)
		if err != nil {
			continue
		}
		page.Items = append(page.Items, normalized)
		if page.BackfillWatermark.IsZero() || publishedAt.Before(page.BackfillWatermark) {
			page.BackfillWatermark = publishedAt
		}
	}
	if reachedLowerBound || len(statuses) < pageSize || lastStatusID == "" {
		return page, nil
	}
	nextCursor, err := encodeMastodonAccountContentCursor(mastodonAccountContentCursor{InstanceURL: instanceURL, MaxID: lastStatusID})
	if err != nil {
		return AccountContentPage{}, err
	}
	page.NextCursor = nextCursor
	return page, nil
}

func mastodonAccountContentProfile(media []struct {
	Type string `json:"type"`
}) string {
	if len(media) == 0 {
		return "short_text"
	}
	for _, attachment := range media {
		if attachment.Type == "video" || attachment.Type == "gifv" || attachment.Type == "audio" {
			return "short_video"
		}
	}
	if len(media) > 1 {
		return "carousel"
	}
	return "image_post"
}

func safeMastodonStatusURL(instanceURL string, status mastodonAccountContentStatus) string {
	if candidate := strings.TrimSpace(status.URL); candidate != "" && sameProviderOrigin(instanceURL, candidate) && IsSafeContentURL(candidate) {
		parsed, _ := url.Parse(candidate)
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	}
	username := strings.TrimSpace(status.Account.Username)
	if username == "" || strings.TrimSpace(status.ID) == "" {
		return ""
	}
	return instanceURL + "/@" + url.PathEscape(username) + "/" + url.PathEscape(strings.TrimSpace(status.ID))
}

func sameProviderOrigin(base, candidate string) bool {
	baseURL, baseErr := url.Parse(base)
	candidateURL, candidateErr := url.Parse(candidate)
	return baseErr == nil && candidateErr == nil && strings.EqualFold(baseURL.Scheme, candidateURL.Scheme) && strings.EqualFold(baseURL.Host, candidateURL.Host) && candidateURL.User == nil
}

func encodeMastodonAccountContentCursor(cursor mastodonAccountContentCursor) (string, error) {
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", fmt.Errorf("encoding mastodon discovery cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func mastodonDiscoveryHTTPClient(instanceURL string) *http.Client {
	// Tests inject a package client before constructing requests. Production
	// instance traffic always uses the guarded client below.
	if httpClient != defaultPlatformHTTPClient {
		return httpClient
	}
	policy := netguard.URLPolicy{Label: "mastodon instance", AllowedSchemes: []string{"https"}}
	return mastodonDiscoveryHTTPClientWithPolicy(instanceURL, policy)
}

func mastodonDiscoveryHTTPClientWithPolicy(instanceURL string, policy netguard.URLPolicy) *http.Client {
	base, _ := url.Parse(instanceURL)
	client := netguard.NewHTTPClient(30*time.Second, policy)
	client.CheckRedirect = func(request *http.Request, _ []*http.Request) error {
		if err := netguard.ValidateURL(request.Context(), request.URL, policy); err != nil {
			return err
		}
		if !strings.EqualFold(request.URL.Scheme, base.Scheme) || !strings.EqualFold(request.URL.Host, base.Host) {
			return fmt.Errorf("mastodon instance redirect changed origin")
		}
		return nil
	}
	return client
}

func decodeMastodonAccountContentCursor(raw, instanceURL string) (mastodonAccountContentCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return mastodonAccountContentCursor{InstanceURL: instanceURL}, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return mastodonAccountContentCursor{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	var cursor mastodonAccountContentCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.InstanceURL != instanceURL || strings.TrimSpace(cursor.MaxID) == "" {
		return mastodonAccountContentCursor{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	return cursor, nil
}

func socialAccountContentDiscoveryError(err error) error {
	var httpErr *HTTPError
	if !errors.As(err, &httpErr) {
		return err
	}
	code := firstNonEmptyString(httpErr.Code, "provider_request_failed")
	switch httpErr.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, code, 0)
	case http.StatusNotFound, http.StatusBadRequest:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, code, 0)
	case http.StatusTooManyRequests:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryRateLimited, code, httpErr.RetryAfter)
	default:
		return NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, code, httpErr.RetryAfter)
	}
}
