package platform

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"
)

type AnalyticsStatus string

const (
	AnalyticsStatusOK                 AnalyticsStatus = "ok"
	AnalyticsStatusPending            AnalyticsStatus = "pending"
	AnalyticsStatusUnsupported        AnalyticsStatus = "unsupported"
	AnalyticsStatusPermissionRequired AnalyticsStatus = "permission_required"
	AnalyticsStatusRateLimited        AnalyticsStatus = "rate_limited"
	AnalyticsStatusNotFound           AnalyticsStatus = "not_found"
	AnalyticsStatusFailed             AnalyticsStatus = "failed"
)

const (
	MetricFollowers   = "followers"
	MetricFollowing   = "following"
	MetricPosts       = "posts"
	MetricLikes       = "likes"
	MetricComments    = "comments"
	MetricReposts     = "reposts"
	MetricQuotes      = "quotes"
	MetricShares      = "shares"
	MetricSaves       = "saves"
	MetricViews       = "views"
	MetricImpressions = "impressions"
	MetricReach       = "reach"
	MetricClicks      = "clicks"
)

// AnalyticsValues is deliberately open-ended. Providers expose different
// counters, and a missing key is distinct from a measured zero.
type AnalyticsValues map[string]int64

type AnalyticsSupport struct {
	Account               bool
	Content               bool
	AccountRequiredScopes []string
	ContentRequiredScopes []string
	AccountUnavailable    string
	ContentUnavailable    string
}

// AnalyticsAccountContext lets adapters describe support that varies by the
// selected provider identity. LinkedIn, for example, grants different
// reporting permissions to member profiles and organization Pages.
type AnalyticsAccountContext struct {
	AccountID       string
	GrantedScopes   string
	CapabilityState map[string]string
}

// AccountAnalyticsSupportResolver is optional. Adapters with account-specific
// analytics capabilities can implement it without widening the publishing
// Adapter interface.
type AccountAnalyticsSupportResolver interface {
	AnalyticsSupportForAccount(input AnalyticsAccountContext) AnalyticsSupport
}

type AccountAnalyticsRequest struct {
	AccountID       string
	GrantedScopes   []string
	CapabilityState map[string]string
}

type ContentAnalyticsRequest struct {
	AccountID     string
	ExternalIDs   []string
	Profile       string
	OutputProfile string
	PublishedAt   time.Time
	GrantedScopes []string
	OwnReplyCount int
}

// AnalyticsAdapter is optional so publishing remains independent from
// reporting. Future inbox, notification, and message capabilities can follow
// the same extension pattern without expanding Adapter.
type AnalyticsAdapter interface {
	AnalyticsSupport() AnalyticsSupport
	FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error)
	FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error)
}

type AnalyticsError struct {
	Status     AnalyticsStatus
	Code       string
	RetryAfter time.Duration
}

func (e *AnalyticsError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("analytics unavailable (%s, code %s)", e.Status, e.Code)
	}
	return fmt.Sprintf("analytics unavailable (%s)", e.Status)
}

func NewAnalyticsError(status AnalyticsStatus, code string) error {
	return &AnalyticsError{Status: status, Code: strings.TrimSpace(code)}
}

func MissingAnalyticsScopes(granted string, required []string) []string {
	if len(required) == 0 {
		return nil
	}
	fields := strings.FieldsFunc(granted, func(r rune) bool {
		return r == ' ' || r == ',' || r == ';'
	})
	missing := make([]string, 0, len(required))
	for _, scope := range required {
		if !slices.Contains(fields, scope) {
			missing = append(missing, scope)
		}
	}
	return missing
}

func AddAnalyticsValues(target, values AnalyticsValues) {
	for metric, value := range values {
		target[metric] += value
	}
}

func EngagementTotal(values AnalyticsValues) int64 {
	var total int64
	for _, metric := range engagementMetrics {
		total += values[metric]
	}
	return total
}

var engagementMetrics = []string{
	MetricLikes,
	MetricComments,
	MetricReposts,
	MetricQuotes,
	MetricShares,
	MetricSaves,
	MetricClicks,
}

func HasEngagementMetric(values AnalyticsValues) bool {
	for _, metric := range engagementMetrics {
		if _, ok := values[metric]; ok {
			return true
		}
	}
	return false
}
