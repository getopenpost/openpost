package botingress

import (
	"strings"
	"unicode/utf8"
)

func normalizeProvider(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validProvider(value string) bool {
	if len(value) == 0 || len(value) > 32 {
		return false
	}
	for index, char := range value {
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || (index > 0 && (char == '_' || char == '-')) {
			continue
		}
		return false
	}
	return true
}

func validKind(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '_' || char == '.' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func validSafeCode(value string) bool {
	return value == "" || validKind(value)
}

func validReference(value string, maxLength int, required bool) bool {
	if !utf8.ValidString(value) || len(value) > maxLength || required && value == "" {
		return false
	}
	for _, char := range value {
		if char < 0x20 || char == 0x7f {
			return false
		}
	}
	return true
}
