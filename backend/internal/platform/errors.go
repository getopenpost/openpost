package platform

import (
	"encoding/json"
	"errors"
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
	Subcode    string
	RetryAfter time.Duration
}

func (e *HTTPError) Error() string {
	if e.Code != "" && e.Subcode != "" {
		return fmt.Sprintf("provider request failed with status %d (code %s, subcode %s)", e.StatusCode, e.Code, e.Subcode)
	}
	if e.Code != "" {
		return fmt.Sprintf("provider request failed with status %d (code %s)", e.StatusCode, e.Code)
	}
	return fmt.Sprintf("provider request failed with status %d", e.StatusCode)
}

func NewHTTPError(statusCode int, headers http.Header, responseBody []byte) error {
	code, subcode := providerErrorMetadata(responseBody)
	return &HTTPError{
		StatusCode: statusCode,
		Code:       code,
		Subcode:    subcode,
		RetryAfter: parseRetryAfter(headers.Get("Retry-After"), time.Now().UTC()),
	}
}

func providerErrorMetadata(body []byte) (string, string) {
	if len(body) == 0 || len(body) > 256*1024 {
		return "", ""
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return "", ""
	}
	candidates := []any{payload["code"], payload["error_code"], payload["type"]}
	var subcodeCandidates []any
	if nested, ok := payload["error"].(map[string]any); ok {
		candidates = append(candidates, nested["code"], nested["type"])
		subcodeCandidates = append(subcodeCandidates, nested["error_subcode"], nested["subcode"])
	}
	return firstSafeProviderCode(candidates), firstSafeProviderCode(subcodeCandidates)
}

func firstSafeProviderCode(candidates []any) string {
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

func normalizeMetaPublishError(err error) error {
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) {
		return err
	}
	if _, parseErr := strconv.Atoi(providerErr.Code); parseErr != nil {
		return err
	}
	switch providerErr.Code {
	case "190":
		providerErr.StatusCode = http.StatusUnauthorized
		providerErr.Code = "meta:token_expired:190"
	case "10", "200":
		providerErr.StatusCode = http.StatusForbidden
		providerErr.Code = "meta:permission:" + providerErr.Code
	case "4", "17", "80001", "80002":
		providerErr.StatusCode = http.StatusTooManyRequests
		providerErr.Code = "meta:rate_limit:" + providerErr.Code
	case "1", "2":
		providerErr.StatusCode = http.StatusServiceUnavailable
		providerErr.Code = "meta:transient:" + providerErr.Code
	default:
		providerErr.Code = "meta:" + providerErr.Code
	}
	return err
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
