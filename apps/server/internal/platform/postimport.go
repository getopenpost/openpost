package platform

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const (
	NativePostMaxTextCharacters  = 10_000
	NativePostMaxTitleCharacters = 500
	NativePostMaxPageSize        = 50
)

// ImportedPostOriginExternal marks content authored outside OpenPost. The
// imported-posts library stores only external rows; OpenPost-published
// content stays in publications and renditions. This marker is the loop guard:
// imported rows are read-only and never enter publishing flows.
const ImportedPostOriginExternal = "external"

type NativePostStatus string

const (
	NativePostComplete           NativePostStatus = "complete"
	NativePostPartial            NativePostStatus = "partial"
	NativePostPermissionRequired NativePostStatus = "permission_required"
	NativePostRateLimited        NativePostStatus = "rate_limited"
	NativePostCostLimited        NativePostStatus = "cost_limited"
	NativePostUnsupported        NativePostStatus = "unsupported"
	NativePostFailed             NativePostStatus = "failed"
)

// NativePostSupport describes native-read support for one provider. Importing
// is an explicit per-account opt-in and never expands the publishing Adapter.
type NativePostSupport struct {
	Supported         bool
	RequiredScopes    []string
	MinPageSize       int
	MaxPageSize       int
	UnavailableReason string
}

// NativePostError is a provider-neutral outcome. Code must be a short stable
// provider code; response bodies and request details never cross this boundary.
type NativePostError struct {
	Status     NativePostStatus
	Code       string
	RetryAfter time.Duration
}

func (e *NativePostError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("native post read unavailable (%s, code %s)", e.Status, e.Code)
	}
	return fmt.Sprintf("native post read unavailable (%s)", e.Status)
}

func NewNativePostError(status NativePostStatus, code string, retryAfter time.Duration) error {
	code = strings.TrimSpace(code)
	if !safeProviderCode.MatchString(code) {
		code = ""
	}
	return &NativePostError{Status: status, Code: code, RetryAfter: max(0, retryAfter)}
}

type NativePostRequest struct {
	AccountID      string
	AccountHandle  string
	InstanceURL    string
	Cursor         string
	PublishedAfter time.Time
	PageSize       int
}

// NativePostItem is the bounded provider-neutral projection returned by a
// native reader. Origin is always external; there is no raw response field.
type NativePostItem struct {
	ProviderPostID   string
	ProviderParentID string
	Title            string
	Text             string
	ExternalURL      string
	PublishedAt      time.Time
	Origin           string
}

type NativePostPage struct {
	Items      []NativePostItem
	NextCursor string
	Coverage   NativePostStatus
}

type NativePostReader interface {
	NativePostSupport() NativePostSupport
	ListNativePosts(ctx context.Context, accessToken string, input NativePostRequest) (NativePostPage, error)
}

// NativePostReadEstimator lets a reader declare the maximum number of provider
// reads needed for a page before the shared durable budget is reserved.
// Readers that do not implement it cost one read per page.
type NativePostReadEstimator interface {
	NativePostReadCost(input NativePostRequest) int
}

// AccountNativePostSupportResolver applies account-type and installation gates
// without making provider calls. Required scopes are checked by the service.
type NativePostAccountContext struct {
	AccountID     string
	GrantedScopes string
}

type AccountNativePostSupportResolver interface {
	ResolveAccountNativePostSupport(input NativePostAccountContext) NativePostSupport
}

func nativePostSupport(scopes ...string) NativePostSupport {
	return NativePostSupport{Supported: true, RequiredScopes: scopes, MinPageSize: 1, MaxPageSize: NativePostMaxPageSize}
}

// NativePostSupportFor reports the installed reader contract. X has no reader,
// irrespective of credentials or operator budget overrides.
func NativePostSupportFor(provider string) NativePostSupport {
	if reader, ok := NewNativePostReader(provider, ""); ok {
		return reader.NativePostSupport()
	}
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case providerX:
		return NativePostSupport{UnavailableReason: "X imports are disabled by the provider read-cost policy."}
	case providerTelegram:
		return NativePostSupport{UnavailableReason: "Telegram's Bot API cannot list posts published directly in a channel."}
	case providerDiscord:
		return NativePostSupport{UnavailableReason: "Discord webhook connections cannot read channel history. Bot connections cannot identify posts authored by the connected webhook."}
	default:
		return NativePostSupport{UnavailableReason: "This provider does not expose native post reads in OpenPost."}
	}
}

func NewNativePostReader(provider, instanceURL string) (NativePostReader, bool) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case providerBluesky:
		return NewBlueskyAdapter(instanceURL), true
	case providerMastodon:
		return NewMastodonAdapter("", "", "", instanceURL), true
	case providerPixelfed:
		return NewPixelfedAdapter("", "", "", instanceURL), true
	case providerThreads:
		return NewThreadsAdapter("", "", ""), true
	case providerFacebook:
		return NewFacebookAdapter("", "", ""), true
	case providerInstagram:
		return NewInstagramAdapter("", "", ""), true
	case providerTikTok:
		return NewTikTokAdapter("", "", ""), true
	case providerYouTube:
		return NewYouTubeAdapter("", "", ""), true
	case providerPinterest:
		return NewPinterestAdapter("", "", ""), true
	case providerLinkedIn:
		return NewLinkedInAdapter("", "", "", false, true), true
	case providerGoogleBusiness:
		return NewGoogleBusinessAdapter("", "", ""), true
	case providerPeerTube:
		return NewPeerTubeAdapter(instanceURL), true
	case providerLemmy:
		return NewLemmyAdapter(instanceURL), true
	case providerPieFed:
		return NewPieFedAdapter(instanceURL), true
	default:
		return nil, false
	}
}

// Providers do not all guarantee publication-time ordering. Filter the window
// locally and retain pagination unless the reader proves it is exhausted.
func appendNativePost(page *NativePostPage, input NativePostRequest, item NativePostItem) {
	if !item.PublishedAt.After(input.PublishedAfter) {
		return
	}
	item.Origin = ImportedPostOriginExternal
	normalized, err := NormalizeNativePostItem(item)
	if err != nil {
		return
	}
	for _, prior := range page.Items {
		if prior.ProviderPostID == normalized.ProviderPostID {
			return
		}
	}
	page.Items = append(page.Items, normalized)
}

func nativePostTime(value string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05-0700", "2006-01-02T15:04:05.999999999"} {
		if parsed, err := time.Parse(layout, strings.TrimSpace(value)); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func nativePostContinuation(cursor, previous string) (NativePostPage, error) {
	page := NativePostPage{Coverage: NativePostComplete}
	if cursor == "" {
		return page, nil
	}
	if len(cursor) > 4096 || cursor == previous {
		return NativePostPage{}, NewNativePostError(NativePostFailed, "invalid_provider_cursor", 0)
	}
	page.NextCursor = cursor
	page.Coverage = NativePostPartial
	return page, nil
}

// NormalizeNativePostItem bounds the normalized fields that cross the
// persistence boundary. Provider identities are rejected rather than
// truncated because truncation could merge two remote items. Only external
// origin is accepted; OpenPost-published content is never importable.
func NormalizeNativePostItem(item NativePostItem) (NativePostItem, error) {
	item.ProviderPostID = strings.TrimSpace(item.ProviderPostID)
	item.ProviderParentID = strings.TrimSpace(item.ProviderParentID)
	if item.ProviderPostID == "" || utf8.RuneCountInString(item.ProviderPostID) > 500 {
		return NativePostItem{}, fmt.Errorf("provider post ID is required and must not exceed 500 characters")
	}
	if utf8.RuneCountInString(item.ProviderParentID) > 500 {
		return NativePostItem{}, fmt.Errorf("provider parent ID must not exceed 500 characters")
	}
	if item.PublishedAt.IsZero() {
		return NativePostItem{}, fmt.Errorf("provider publish time is required")
	}
	item.PublishedAt = item.PublishedAt.UTC()
	item.Title = truncateNativePostRunes(normalizeNativePostTitle(item.Title), NativePostMaxTitleCharacters)
	item.Text = truncateNativePostRunes(normalizeNativePostText(item.Text), NativePostMaxTextCharacters)
	item.ExternalURL = strings.TrimSpace(item.ExternalURL)
	if item.ExternalURL != "" && !IsSafeContentURL(item.ExternalURL) {
		return NativePostItem{}, fmt.Errorf("provider content URL is unsafe")
	}
	if strings.TrimSpace(item.Origin) != ImportedPostOriginExternal {
		return NativePostItem{}, fmt.Errorf("native posts must carry external origin")
	}
	item.Origin = ImportedPostOriginExternal
	return item, nil
}

func normalizeNativePostTitle(value string) string {
	return strings.Join(strings.Fields(norm.NFC.String(strings.ReplaceAll(value, "\x00", ""))), " ")
}

func normalizeNativePostText(value string) string {
	value = norm.NFC.String(value)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.ReplaceAll(value, "\x00", "")
	return strings.TrimSpace(value)
}

func truncateNativePostRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func nativePostPageSize(input NativePostRequest, support NativePostSupport) int {
	minSize := max(1, support.MinPageSize)
	maxSize := support.MaxPageSize
	if maxSize <= 0 {
		maxSize = NativePostMaxPageSize
	}
	if input.PageSize <= 0 {
		return min(minSize, maxSize)
	}
	return min(max(minSize, input.PageSize), maxSize)
}

func nativePostEndpoint(base, path string, params url.Values) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	encoded := params.Encode()
	if encoded == "" {
		return base + path
	}
	return base + path + "?" + encoded
}

// NativePostPublishedIdentity resolves an authored receipt to the identity
// returned by native reads. Receipt parsing stays with the provider owner.
func NativePostPublishedIdentity(provider, externalID string) string {
	if strings.EqualFold(provider, providerBluesky) {
		return blueskyExternalURI(externalID)
	}
	return strings.TrimSpace(externalID)
}
