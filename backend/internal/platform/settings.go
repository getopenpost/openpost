package platform

import (
	"fmt"
	"strconv"
	"strings"
)

func settingString(settings map[string]interface{}, key string) string {
	if settings == nil {
		return ""
	}
	value, ok := settings[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func settingBool(settings map[string]interface{}, key string) bool {
	if settings == nil {
		return false
	}
	value, ok := settings[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on"
	default:
		return strings.EqualFold(fmt.Sprint(value), "true")
	}
}

func settingBoolDefault(settings map[string]interface{}, key string, fallback bool) bool {
	if settings == nil {
		return fallback
	}
	if _, ok := settings[key]; !ok {
		return fallback
	}
	return settingBool(settings, key)
}

func settingInt(settings map[string]interface{}, key string) int {
	if settings == nil {
		return 0
	}
	value, ok := settings[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return 0
}

func contentWithSettingURL(content string, settings map[string]interface{}) string {
	content = strings.TrimSpace(content)
	link := firstNonEmptyString(settingString(settings, "url"), settingString(settings, "link_url"))
	if link == "" || strings.Contains(content, link) {
		return content
	}
	if content == "" {
		return link
	}
	return content + "\n" + link
}
