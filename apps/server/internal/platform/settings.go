package platform

import (
	"strings"

	"github.com/openpost/backend/internal/textutil"

	"github.com/openpost/backend/internal/settingx"
)

func settingString(settings map[string]interface{}, key string) string {
	return settingx.String(settings, key)
}

func settingBool(settings map[string]interface{}, key string) bool {
	return settingx.Bool(settings, key)
}

// settingBoolPtr keeps an explicit false: nil when the key is absent or null, so
// providers can tell "not set" (use the account default) from "set to false".
func settingBoolPtr(settings map[string]interface{}, key string) *bool {
	return settingx.BoolPtr(settings, key)
}

func settingBoolDefault(settings map[string]interface{}, key string, fallback bool) bool {
	return settingx.BoolDefault(settings, key, fallback)
}

func settingInt(settings map[string]interface{}, key string) int {
	return settingx.Int(settings, key)
}

// ContentWithSettingURL returns the exact text sent by text-based adapters
// that append a configured destination URL.
func ContentWithSettingURL(content string, settings map[string]interface{}) string {
	content = strings.TrimSpace(content)
	link := textutil.FirstNonEmpty(settingString(settings, "url"), settingString(settings, "link_url"))
	if link == "" || strings.Contains(content, link) {
		return content
	}
	if content == "" {
		return link
	}
	return content + "\n" + link
}
