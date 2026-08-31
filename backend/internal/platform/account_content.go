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
	AccountContentMaxTextCharacters  = 10_000
	AccountContentMaxTitleCharacters = 500
	AccountContentMaxPageSize        = 100
)

type AccountContentOrigin string

const (
	AccountContentOriginOpenPost AccountContentOrigin = "openpost"
	AccountContentOriginExternal AccountContentOrigin = "external"
)

type AccountContentOriginConfidence string

const (
	AccountContentOriginConfidenceUnknown  AccountContentOriginConfidence = "unknown"
	AccountContentOriginConfidenceInferred AccountContentOriginConfidence = "inferred"
	AccountContentOriginConfidenceExact    AccountContentOriginConfidence = "exact"
)

type AccountContentDiscoveryStatus string

const (
	AccountContentDiscoveryComplete           AccountContentDiscoveryStatus = "complete"
	AccountContentDiscoveryPartial            AccountContentDiscoveryStatus = "partial"
	AccountContentDiscoveryPermissionRequired AccountContentDiscoveryStatus = "permission_required"
	AccountContentDiscoveryRateLimited        AccountContentDiscoveryStatus = "rate_limited"
	AccountContentDiscoveryCostLimited        AccountContentDiscoveryStatus = "cost_limited"
	AccountContentDiscoveryUnsupported        AccountContentDiscoveryStatus = "unsupported"
	AccountContentDiscoveryFailed             AccountContentDiscoveryStatus = "failed"
)

// AccountContentDiscoverySupport describes account-specific read support.
// Discovery remains optional and does not expand the publishing Adapter.
type AccountContentDiscoverySupport struct {
	Supported         bool
	RequiredScopes    []string
	MaxPageSize       int
	UnavailableReason string
}

// AccountContentDiscoveryError is a provider-neutral outcome. Code must be a
// short stable provider code; response bodies and request details never cross
// this boundary.
type AccountContentDiscoveryError struct {
	Status     AccountContentDiscoveryStatus
	Code       string
	RetryAfter time.Duration
}

func (e *AccountContentDiscoveryError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("account content discovery unavailable (%s, code %s)", e.Status, e.Code)
	}
	return fmt.Sprintf("account content discovery unavailable (%s)", e.Status)
}

func NewAccountContentDiscoveryError(status AccountContentDiscoveryStatus, code string, retryAfter time.Duration) error {
	code = strings.TrimSpace(code)
	if !safeProviderCode.MatchString(code) {
		code = ""
	}
	return &AccountContentDiscoveryError{Status: status, Code: code, RetryAfter: max(0, retryAfter)}
}

type AccountContentDiscoveryRequest struct {
	AccountID       string
	GrantedScopes   []string
	CapabilityState map[string]string
	Cursor          string
	PublishedAfter  time.Time
	PageSize        int
}

type AccountContentCoverage struct {
	Status      AccountContentDiscoveryStatus
	Description string
}

// AccountContentItem is the bounded provider-neutral projection returned by a
// discovery adapter. It deliberately has no raw response field.
type AccountContentItem struct {
	ProviderContentID string
	ProviderParentID  string
	ContentProfile    string
	Title             string
	Text              string
	ExternalURL       string
	PublishedAt       time.Time
	Origin            AccountContentOrigin
	OriginConfidence  AccountContentOriginConfidence
	RenditionID       string
	Measurements      AnalyticsMeasurements
}

type AccountContentPage struct {
	Items             []AccountContentItem
	NextCursor        string
	BackfillWatermark time.Time
	Coverage          AccountContentCoverage
}

type AccountContentDiscoverer interface {
	AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport
	DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error)
}

type AccountContentBatchMeasurementRequest struct {
	AccountID          string
	GrantedScopes      []string
	CapabilityState    map[string]string
	ProviderContentIDs []string
}

// AccountContentBatchMeasurements is keyed by stable provider content ID. A
// provider-wide aggregate can therefore never be mistaken for item metrics.
type AccountContentBatchMeasurements map[string]AnalyticsMeasurements

type AccountContentBatchMeasurer interface {
	FetchAccountContentBatchMeasurements(ctx context.Context, accessToken string, input AccountContentBatchMeasurementRequest) (AccountContentBatchMeasurements, error)
}

// NormalizeAccountContentItem bounds the normalized fields that cross the
// analytics persistence boundary. Provider identities are rejected rather
// than truncated because truncation could merge two remote items.
func NormalizeAccountContentItem(provider string, item AccountContentItem) (AccountContentItem, error) {
	item.ProviderContentID = strings.TrimSpace(item.ProviderContentID)
	item.ProviderParentID = strings.TrimSpace(item.ProviderParentID)
	item.ContentProfile = strings.TrimSpace(item.ContentProfile)
	item.RenditionID = strings.TrimSpace(item.RenditionID)
	if item.ProviderContentID == "" || utf8.RuneCountInString(item.ProviderContentID) > 500 {
		return AccountContentItem{}, fmt.Errorf("provider content ID is required and must not exceed 500 characters")
	}
	if utf8.RuneCountInString(item.ProviderParentID) > 500 {
		return AccountContentItem{}, fmt.Errorf("provider parent ID must not exceed 500 characters")
	}
	if item.PublishedAt.IsZero() {
		return AccountContentItem{}, fmt.Errorf("provider publish time is required")
	}
	item.PublishedAt = item.PublishedAt.UTC()
	item.Title = truncateAccountContentRunes(normalizeAccountContentTitle(item.Title), AccountContentMaxTitleCharacters)
	item.Text = truncateAccountContentRunes(normalizeAccountContentText(item.Text), AccountContentMaxTextCharacters)
	item.ExternalURL = strings.TrimSpace(item.ExternalURL)
	if item.ExternalURL != "" && !IsSafeProviderContentURL(provider, item.ExternalURL) {
		return AccountContentItem{}, fmt.Errorf("provider content URL is unsafe")
	}
	switch item.Origin {
	case AccountContentOriginOpenPost, AccountContentOriginExternal:
	default:
		return AccountContentItem{}, fmt.Errorf("account content origin must be openpost or external")
	}
	if item.OriginConfidence == "" {
		item.OriginConfidence = AccountContentOriginConfidenceUnknown
	}
	switch item.OriginConfidence {
	case AccountContentOriginConfidenceUnknown, AccountContentOriginConfidenceInferred, AccountContentOriginConfidenceExact:
	default:
		return AccountContentItem{}, fmt.Errorf("unsupported account content origin confidence %q", item.OriginConfidence)
	}
	return item, nil
}

func IsSafeProviderContentURL(provider, value string) bool {
	if !IsSafeContentURL(value) {
		return false
	}
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	providerHosts := map[string][]string{
		"x":         {"x.com", "twitter.com"},
		"youtube":   {"youtube.com", "youtu.be"},
		"tiktok":    {"tiktok.com"},
		"linkedin":  {"linkedin.com"},
		"instagram": {"instagram.com"},
		"facebook":  {"facebook.com", "fb.watch"},
		"threads":   {"threads.net"},
		"bluesky":   {"bsky.app"},
		"pinterest": {"pinterest.com", "pin.it"},
		"telegram":  {"t.me", "telegram.me"},
		"discord":   {"discord.com", "discordapp.com"},
	}
	allowed, knownProvider := providerHosts[strings.ToLower(strings.TrimSpace(provider))]
	if !knownProvider {
		// Federated and operator-installed providers validate their own host, but
		// still pass the common HTTPS/no-credentials boundary above.
		return true
	}
	for _, suffix := range allowed {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

func normalizeAccountContentTitle(value string) string {
	return strings.Join(strings.Fields(norm.NFC.String(strings.ReplaceAll(value, "\x00", ""))), " ")
}

func normalizeAccountContentText(value string) string {
	value = norm.NFC.String(value)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.ReplaceAll(value, "\x00", "")
	return strings.TrimSpace(value)
}

func truncateAccountContentRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
