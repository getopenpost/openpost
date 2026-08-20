package growth

import (
	"errors"
	"net/url"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

func isTerminalFollowState(state string) bool {
	switch state {
	case models.GrowthRecommendationFollowFollowing, models.GrowthRecommendationFollowRequested, models.GrowthRecommendationFollowFailed:
		return true
	default:
		return false
	}
}

func safeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return ""
	}
	parsed, err := parseAndValidateHTTPSURL(raw)
	if err != nil {
		return ""
	}
	return parsed
}

func parseAndValidateHTTPSURL(raw string) (string, error) {
	u, err := parseURL(raw)
	if err != nil {
		return "", err
	}
	if u.Scheme != "https" {
		return "", errors.New("https required")
	}
	if u.Host == "" {
		return "", errors.New("host required")
	}
	if u.User != nil {
		return "", errors.New("credentials not allowed")
	}
	return u.String(), nil
}

func parseURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	return parsed, nil
}

func boundedText(s string, limit int) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) <= limit {
		return s
	}
	return string([]rune(s)[:limit])
}

func classifyGrowthError(err error) (status, code, message string) {
	if err == nil {
		return models.GrowthSyncStatusFailed, "", "unknown error"
	}
	var httpErr *platform.HTTPError
	if errors.As(err, &httpErr) {
		code = strings.TrimSpace(httpErr.Code)
		switch {
		case httpErr.StatusCode == 401 || httpErr.StatusCode == 403:
			return models.GrowthSyncStatusPermissionRequired, firstNonEmpty(code, "permission"), "Reconnect this account to continue discovery."
		case httpErr.StatusCode == 429:
			return models.GrowthSyncStatusRateLimited, firstNonEmpty(code, "rate_limited"), "The provider is rate limiting. OpenPost will retry."
		case httpErr.StatusCode >= 500:
			return models.GrowthSyncStatusTemporarilyUnavailable, firstNonEmpty(code, "provider_server"), "The provider is temporarily unavailable."
		default:
			return models.GrowthSyncStatusFailed, firstNonEmpty(code, "provider_error"), "Discovery failed."
		}
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "token") || strings.Contains(lower, "auth") || strings.Contains(lower, "permission") {
		return models.GrowthSyncStatusPermissionRequired, "authentication", "Reconnect this account to continue discovery."
	}
	if strings.Contains(lower, "rate") {
		return models.GrowthSyncStatusRateLimited, "rate_limited", "The provider is rate limiting."
	}
	return models.GrowthSyncStatusTemporarilyUnavailable, "unknown", "OpenPost could not reach the provider."
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func providerKeyForAccount(account models.SocialAccount) string {
	if account.Platform == "mastodon" {
		instance := strings.TrimSpace(account.InstanceURL)
		instance = strings.TrimRight(instance, "/")
		if instance != "" {
			return "mastodon:" + instance
		}
	}
	return account.Platform
}

func mutualCountBucket(count int) string {
	switch {
	case count == 0:
		return "0"
	case count <= 2:
		return "1-2"
	case count <= 5:
		return "3-5"
	default:
		return "6+"
	}
}
