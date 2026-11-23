package textutil

import (
	"strings"
	"unicode/utf8"
)

// FirstNonEmpty returns the first value with non-whitespace content, trimmed.
func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// FirstNonEmptyRaw returns the first value with non-whitespace content without
// modifying its leading or trailing whitespace.
func FirstNonEmptyRaw(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// TruncateRunes trims whitespace and bounds value to at most limit runes.
func TruncateRunes(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

// TruncateUTF8Bytes trims whitespace and bounds value to at most maxBytes bytes
// without splitting a multi-byte UTF-8 rune.
func TruncateUTF8Bytes(value string, maxBytes int) string {
	value = strings.TrimSpace(value)
	if maxBytes <= 0 {
		return ""
	}
	if len(value) <= maxBytes {
		return value
	}
	end := maxBytes
	for end > 0 && !utf8.RuneStart(value[end]) {
		end--
	}
	return value[:end]
}
