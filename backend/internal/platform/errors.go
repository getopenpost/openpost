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

var (
	safeProviderCode      = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,96}$`)
	safeProviderMessage   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 .,;:!?'/_()#%+\-]{0,255}$`)
	unsafeProviderMessage = regexp.MustCompile(`(?i)(access.?token|authorization|bearer|client.?secret|password|secret|token)`)
)

// HTTPError preserves bounded provider diagnostics without retaining response
// bodies, post text, tokens, or request URLs.
type HTTPError struct {
	StatusCode int
	Code       string
	Subcode    string
	Message    string
	TraceID    string
	RetryAfter time.Duration
}

func (e *HTTPError) Error() string {
	trace := ""
	if e.TraceID != "" {
		trace = fmt.Sprintf(", trace %s", e.TraceID)
	}
	if e.Code != "" && e.Subcode != "" {
		return fmt.Sprintf("provider request failed with status %d (code %s, subcode %s%s)", e.StatusCode, e.Code, e.Subcode, trace)
	}
	if e.Code != "" {
		return fmt.Sprintf("provider request failed with status %d (code %s%s)", e.StatusCode, e.Code, trace)
	}
	return fmt.Sprintf("provider request failed with status %d", e.StatusCode)
}

func NewHTTPError(statusCode int, headers http.Header, responseBody []byte) error {
	code, subcode, message, traceID := providerErrorMetadata(responseBody)
	return &HTTPError{
		StatusCode: statusCode,
		Code:       code,
		Subcode:    subcode,
		Message:    message,
		TraceID:    traceID,
		RetryAfter: parseRetryAfter(headers.Get("Retry-After"), time.Now().UTC()),
	}
}

func providerErrorMetadata(body []byte) (string, string, string, string) {
	if len(body) == 0 || len(body) > 256*1024 {
		return "", "", "", ""
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return "", "", "", ""
	}
	candidates := []any{payload["code"], payload["error_code"], payload["type"], payload["error"]}
	var subcodeCandidates []any
	messageCandidates := []any{payload["message"]}
	traceCandidates := []any{payload["fbtrace_id"], payload["trace_id"]}
	if nested, ok := payload["error"].(map[string]any); ok {
		candidates = append(candidates, nested["code"], nested["type"])
		subcodeCandidates = append(subcodeCandidates, nested["error_subcode"], nested["subcode"])
		messageCandidates = append(messageCandidates, nested["message"])
		traceCandidates = append(traceCandidates, nested["fbtrace_id"], nested["trace_id"])
	}
	return firstSafeProviderCode(candidates), firstSafeProviderCode(subcodeCandidates),
		firstSafeProviderMessage(messageCandidates), firstSafeProviderCode(traceCandidates)
}

func firstSafeProviderMessage(candidates []any) string {
	for _, candidate := range candidates {
		value, ok := candidate.(string)
		if !ok {
			continue
		}
		message := strings.Join(strings.Fields(value), " ")
		if safeProviderMessage.MatchString(message) && !unsafeProviderMessage.MatchString(message) {
			return message
		}
	}
	return ""
}

func ProviderErrorDiagnostic(err error) string {
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) {
		return ""
	}
	parts := make([]string, 0, 3)
	if providerErr.Subcode != "" {
		parts = append(parts, "subcode="+providerErr.Subcode)
	}
	if providerErr.TraceID != "" {
		parts = append(parts, "trace_id="+providerErr.TraceID)
	}
	if providerErr.Message != "" {
		parts = append(parts, "message="+strconv.Quote(providerErr.Message))
	}
	return strings.Join(parts, " ")
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
	case "1":
		providerErr.StatusCode = http.StatusBadRequest
		providerErr.Code = "meta:rejected:1"
	case "2":
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
