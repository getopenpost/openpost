package platform

import (
	"strings"
	"time"
)

// ProviderTime parses a timestamp taken from a provider payload. Graph and
// Threads send offsets without a colon, X includes fractional seconds, and
// some payloads omit the zone. Accepting every layout keeps a stricter parse
// from silently storing the zero time.
func ProviderTime(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02T15:04:05-0700",
		"2006-01-02T15:04:05.999999999-0700",
		"2006-01-02T15:04:05.999999999",
	} {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}
