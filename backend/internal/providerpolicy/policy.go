// Package providerpolicy derives normalized provider policy subjects from the
// exact account, output capability, and destination settings. It is kept
// dependency-light so authorization snapshots and readiness evaluation can use
// the same policy boundary without an import cycle.
package providerpolicy

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
)

var tokenPattern = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*$`)

func Mode(account models.SocialAccount, capability capabilities.Capability, settings map[string]any) string {
	provider := strings.TrimSpace(capability.Provider)
	if provider == "" {
		provider = strings.TrimSpace(account.Platform)
	}
	switch provider {
	case capabilities.ProviderTikTok:
		method := strings.ToUpper(strings.TrimSpace(stringSetting(settings, "content_posting_method")))
		switch method {
		case "UPLOAD", "MEDIA_UPLOAD":
			return "tiktok.upload"
		case "DIRECT_POST":
			privacy := NormalizeToken(strings.ToLower(stringSetting(settings, "privacy_level")), "unspecified")
			return "tiktok.direct_post." + privacy
		default:
			return "tiktok.unspecified"
		}
	case capabilities.ProviderYouTube:
		privacy := strings.ToLower(strings.TrimSpace(stringSetting(settings, "privacy")))
		switch privacy {
		case "private", "unlisted", "public":
			return "youtube." + privacy
		default:
			return "youtube.unspecified"
		}
	case capabilities.ProviderLinkedIn:
		return "linkedin." + NormalizeToken(AccountKind(account), "standard")
	case capabilities.ProviderInstagram:
		return "instagram." + NormalizeToken(AccountKind(account), "standard")
	case capabilities.ProviderFacebook:
		return "facebook.page"
	default:
		return NormalizeToken(provider, "provider") + ".standard"
	}
}

func AccountKind(account models.SocialAccount) string {
	state := map[string]string{}
	_ = json.Unmarshal([]byte(account.CapabilityState), &state)
	for _, key := range []string{"linkedin_account_type", "instagram_account_type", "connection_type"} {
		if value := NormalizeToken(state[key], ""); value != "" {
			return value
		}
	}
	return "standard"
}

func NormalizeToken(value, fallback string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	if tokenPattern.MatchString(value) {
		return value
	}
	return fallback
}

func stringSetting(settings map[string]any, key string) string {
	value, _ := settings[key].(string)
	return value
}
