package platform

import (
	"encoding/json"
	"strings"
)

// SupportsAnalytics reports whether the given platform has an analytics adapter
// that is enabled by default. This is the canonical source for migration backfill
// and must stay in sync with the per-adapter AnalyticsSupport implementations.
func SupportsAnalytics(platformName string, capabilityState string) bool {
	switch platformName {
	case "x", "bluesky", "mastodon", "facebook", "instagram", "threads", "youtube", "tiktok":
		return true
	case "linkedin":
		if isLinkedInCommunityManagementState(capabilityState) {
			return false
		}
		return true
	case providerTelegram:
		return true
	case providerDiscord:
		return AccountProviderKey(providerDiscord, "", capabilityState) == providerDiscord+":"+ConnectionModeBot
	default:
		return false
	}
}

// SupportsEngagement reports whether the given platform has an engagement adapter
// that is enabled. Canonical for migration backfill.
func SupportsEngagement(platformName string) bool {
	switch platformName {
	case "facebook", "instagram", "linkedin", "threads", "mastodon", "bluesky", "x", "youtube":
		return true
	default:
		return false
	}
}

// SupportsGrow reports whether the platform supports grow discovery.
func SupportsGrow(platformName string) bool {
	switch platformName {
	case "bluesky", "mastodon":
		return true
	default:
		return false
	}
}

func isLinkedInCommunityManagementState(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	var state map[string]string
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return false
	}
	return state["linkedin_account_type"] == "community_management"
}
