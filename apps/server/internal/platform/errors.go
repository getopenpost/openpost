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

// HTTPError preserves bounded provider diagnostics without retaining response
// bodies, post text, tokens, or request URLs.
type HTTPError struct {
	StatusCode int
	Code       string
	Subcode    string
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
	code, subcode, traceID := providerErrorMetadata(responseBody)
	return &HTTPError{
		StatusCode: statusCode,
		Code:       code,
		Subcode:    subcode,
		TraceID:    traceID,
		RetryAfter: parseRetryAfter(headers.Get("Retry-After"), time.Now().UTC()),
	}
}

func providerErrorMetadata(body []byte) (string, string, string) {
	if len(body) == 0 || len(body) > 256*1024 {
		return "", "", ""
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) != nil {
		return "", "", ""
	}
	candidates := []any{payload["code"], payload["error_code"], payload["type"], payload["error"]}
	var subcodeCandidates []any
	traceCandidates := []any{payload["fbtrace_id"], payload["trace_id"]}
	if nested, ok := payload["error"].(map[string]any); ok {
		candidates = append(candidates, nested["code"], nested["type"])
		subcodeCandidates = append(subcodeCandidates, nested["error_subcode"], nested["subcode"])
		traceCandidates = append(traceCandidates, nested["fbtrace_id"], nested["trace_id"])
	}
	return firstSafeProviderCode(candidates), firstSafeProviderCode(subcodeCandidates),
		firstSafeProviderCode(traceCandidates)
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
	code, subcode := providerErr.Code, providerErr.Subcode
	if mapping, ok := metaExactMappings[metaCodeKey{code, subcode}]; ok {
		applyMetaMapping(providerErr, mapping)
		return err
	}
	if mapping, ok := metaCodeMappings[code]; ok {
		applyMetaMapping(providerErr, mapping)
		return err
	}
	if isMetaTerminalMediaCode(code) {
		// Other known Instagram container/media rejections from Postiz
		// handleErrors. Terminal: the media or request must change.
		providerErr.StatusCode = http.StatusBadRequest
		providerErr.Code = "meta:media_rejected:" + code
		return err
	}
	if code == "" {
		// Postiz #2127: Meta outage pages ("Sorry, something went wrong")
		// arrive as non-JSON bodies, so no code survives. A 429/5xx status
		// is still a transient signal worth retrying.
		if providerErr.StatusCode == http.StatusTooManyRequests ||
			providerErr.StatusCode >= http.StatusInternalServerError {
			providerErr.Code = "meta:transient"
		}
		return err
	}
	if _, parseErr := strconv.Atoi(code); parseErr != nil {
		return err
	}
	providerErr.Code = "meta:" + code
	return err
}

type metaCodeKey struct {
	code    string
	subcode string
}

type metaMapping struct {
	status int
	code   string
}

func applyMetaMapping(providerErr *HTTPError, mapping metaMapping) {
	if mapping.status != 0 {
		providerErr.StatusCode = mapping.status
	}
	providerErr.Code = mapping.code
}

// metaExactMappings classifies {code, subcode} pairs where the subcode
// changes the recovery action (Postiz #2127).
var metaExactMappings = map[metaCodeKey]metaMapping{
	{code: "368", subcode: "1390008"}: {status: http.StatusTooManyRequests, code: "meta:rate_limit:368:1390008"},
	// Meta put the account behind a security checkpoint. The token is still
	// valid, so a refresh cannot help; the user must log in at facebook.com,
	// complete the check, then reconnect.
	{code: "190", subcode: "459"}: {status: http.StatusUnauthorized, code: "meta:checkpoint:190:459"},
	// The Facebook user no longer has a role on the Page. Only a Page admin
	// granting a role plus a reconnect can fix it.
	{code: "190", subcode: "492"}: {status: http.StatusForbidden, code: "meta:missing_page_role:190:492"},
	// The targeted Page or post no longer exists. Terminal: retrying the
	// same publish can never succeed.
	{code: "100", subcode: "33"}: {status: http.StatusBadRequest, code: "meta:nonexistent:100:33"},
}

// metaCodeMappings classifies by code alone. 2207082/2207085 come from
// Postiz #2137/#2152: silent-audio processing failures may succeed on
// retry, while format failures need new media.
var metaCodeMappings = map[string]metaMapping{
	"190":     {status: http.StatusUnauthorized, code: "meta:token_expired:190"},
	"2207082": {code: "meta:media_silent_audio:2207082"},
	"2207085": {status: http.StatusBadRequest, code: "meta:media_format:2207085"},
	"10":      {status: http.StatusForbidden, code: "meta:permission:10"},
	"200":     {status: http.StatusForbidden, code: "meta:permission:200"},
	"4":       {status: http.StatusTooManyRequests, code: "meta:rate_limit:4"},
	"17":      {status: http.StatusTooManyRequests, code: "meta:rate_limit:17"},
	"80001":   {status: http.StatusTooManyRequests, code: "meta:rate_limit:80001"},
	"80002":   {status: http.StatusTooManyRequests, code: "meta:rate_limit:80002"},
	"1":       {status: http.StatusBadRequest, code: "meta:rejected:1"},
	"2":       {status: http.StatusServiceUnavailable, code: "meta:transient:2"},
}

// isMetaTerminalMediaCode reports whether a numeric Meta code is a known
// terminal Instagram media/container rejection (Postiz handleErrors).
func isMetaTerminalMediaCode(code string) bool {
	switch code {
	case "2207001", "2207005", "2207009", "2207023", "2207027",
		"2207042", "2207051", "2207077", "36001", "36003":
		return true
	default:
		return false
	}
}

// MetaFailureMessage returns a curated user-facing message for a normalized
// Meta error code. Unknown codes get an empty string so callers fall back to
// their generic message. Messages are fixed strings: provider response text
// never flows into them.
func MetaFailureMessage(code string) string {
	if message, ok := metaFailureMessages[code]; ok {
		return message
	}
	if strings.HasPrefix(code, "meta:media_rejected:") {
		if message, ok := metaMediaRejectedMessages[strings.TrimPrefix(code, "meta:media_rejected:")]; ok {
			return message
		}
		return "Instagram could not process this media. Replace the media before publishing again."
	}
	return ""
}

var metaFailureMessages = map[string]string{
	"meta:rate_limit:368:1390008":     "Facebook temporarily limited posting for this account. OpenPost will retry later.",
	"meta:checkpoint:190:459":         "Facebook asked for a security check. Log in at facebook.com, complete it, then reconnect this account and try again.",
	"meta:checkpoint:instagram":       "Instagram asked for a login check. Log in at instagram.com, follow its instructions, then reconnect this account.",
	"meta:missing_page_role:190:492":  "Your Facebook user no longer has a role on this Page. Ask a Page admin to grant you a role, then reconnect this account.",
	"meta:nonexistent:100:33":         "The Facebook Page or post this was targeting no longer exists. Reconnect this account and schedule again.",
	"meta:media_silent_audio:2207082": "Instagram could not process this video. If you attached audio to a video that has no sound track, set the original video volume to 0 and try again.",
	"meta:media_format:2207085":       "Instagram could not process the video. Check the video format, duration, and resolution, then try again.",
}

var metaMediaRejectedMessages = map[string]string{
	"2207001": "Instagram flagged this post as spam. Try again with different content.",
	"2207005": "Unsupported image format.",
	"2207009": "Aspect ratio not supported, must be between 4:5 and 1.91:1.",
	"2207023": "Unknown media type.",
	"2207027": "Instagram could not process the media. Try again later or contact support.",
	"2207042": "You have reached the maximum of 25 posts per day for this account.",
	"2207051": "Instagram blocked this request.",
	"2207077": "Instagram video download failed.",
	"36001":   "Invalid Instagram image resolution, max 1920x1080px.",
	"36003":   "Aspect ratio not supported, must be between 4:5 and 1.91:1.",
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
