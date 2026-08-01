package platform

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var safeProviderCode = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,96}$`)

// HTTPError preserves the provider's status, stable code, and retry hint
// without retaining response bodies, post text, tokens, or request URLs.
type HTTPError struct {
	StatusCode int
	Code       string
	RetryAfter time.Duration
}

func (e *HTTPError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("provider request failed with status %d (code %s)", e.StatusCode, e.Code)
	}
	return fmt.Sprintf("provider request failed with status %d", e.StatusCode)
}

func NewHTTPError(statusCode int, headers http.Header, responseBody []byte) error {
	return &HTTPError{
		StatusCode: statusCode,
		Code:       providerErrorCode(responseBody),
		RetryAfter: parseRetryAfter(headers.Get("Retry-After"), time.Now().UTC()),
	}
}

func providerErrorCode(body []byte) string {
	if len(body) == 0 || len(body) > 256*1024 {
		return ""
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return ""
	}
	candidates := []any{payload["code"], payload["error_code"], payload["type"]}
	if nested, ok := payload["error"].(map[string]any); ok {
		candidates = append(candidates, nested["code"], nested["type"])
	}
	for _, candidate := range candidates {
		var code string
		switch value := candidate.(type) {
		case string:
			code = strings.TrimSpace(value)
		case float64:
			code = strconv.FormatInt(int64(value), 10)
		}
		if safeProviderCode.MatchString(code) {
			return code
		}
	}
	return ""
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if retryAt, err := http.ParseTime(value); err == nil && retryAt.After(now) {
		return retryAt.Sub(now)
	}
	return 0
}
