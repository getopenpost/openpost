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

// NativePostReadEstimator lets a reader declare the exact number of provider
// reads needed for a page before the shared durable budget is reserved.
// Readers that do not implement it cost one read per page.
type NativePostReadEstimator interface {
	NativePostReadCost(input NativePostRequest) int
}

// NativePostSupportFor reports native-read support without touching the
// provider. X stays disabled by the read-cost policy until a metered x_read
// budget exists. Remaining providers are explicit TODOs, not silent gaps.
func NativePostSupportFor(provider string) NativePostSupport {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case providerBluesky:
		return NativePostSupport{Supported: true, MinPageSize: 1, MaxPageSize: NativePostMaxPageSize}
	case providerMastodon:
		return NativePostSupport{Supported: true, MinPageSize: 1, MaxPageSize: NativePostMaxPageSize}
	case providerX:
		return NativePostSupport{UnavailableReason: "X native reads are disabled by the provider read-cost policy (TODO: metered x_read budget)."}
	case providerThreads:
		return NativePostSupport{UnavailableReason: "Threads native reads are not implemented yet (TODO)."}
	case providerInstagram:
		return NativePostSupport{UnavailableReason: "Instagram native reads are not implemented yet (TODO: Business account media edge)."}
	case providerFacebook:
		return NativePostSupport{UnavailableReason: "Facebook native reads are not implemented yet (TODO: page-authorship filter)."}
	case providerLinkedIn:
		return NativePostSupport{UnavailableReason: "LinkedIn personal timeline reads are partner-gated and out of scope (TODO)."}
	case providerTikTok:
		return NativePostSupport{UnavailableReason: "TikTok native reads are not implemented yet (TODO)."}
	case providerYouTube:
		return NativePostSupport{UnavailableReason: "YouTube native reads are not implemented yet (TODO)."}
	case providerPinterest:
		return NativePostSupport{UnavailableReason: "Pinterest native reads are not implemented yet (TODO)."}
	default:
		return NativePostSupport{UnavailableReason: "This provider does not expose native post reads in OpenPost."}
	}
}

// NewNativePostReader builds the reader for providers with native-read
// support. Instance URL scoping keeps reads on the connected account's host
// (PDS or instance). It returns false for every provider without an
// implementation, including X while its read budget is disabled.
func NewNativePostReader(provider, instanceURL string) (NativePostReader, bool) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case providerBluesky:
		return NewBlueskyAdapter(instanceURL), true
	case providerMastodon:
		return NewMastodonAdapter("", "", "", instanceURL), true
	default:
		return nil, false
	}
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
