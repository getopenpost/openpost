package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/platform"
)

const (
	externalAnalyticsTimeout       = 10 * time.Second
	externalAnalyticsMaxRetryAfter = 7 * 24 * time.Hour
	externalAnalyticsMaxBodyBytes  = 64 * 1024
	externalAnalyticsStatusFailed  = "failed"
	externalAnalyticsCodeResponse  = "external_source_invalid_response"
	externalAnalyticsCodeBodyLarge = "external_source_response_too_large"
	externalAnalyticsCodeRedirect  = "external_source_redirect_blocked"
)

var externalAnalyticsCodePattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,96}$`)

type externalAnalyticsAdapter struct {
	platform.Adapter
	platformName string
	baseURL      *url.URL
	bearerToken  string
	client       *http.Client
}

type externalAnalyticsEnvelope struct {
	Metrics           map[string]json.Number `json:"metrics"`
	Status            string                 `json:"status"`
	Code              string                 `json:"code"`
	RetryAfterSeconds int64                  `json:"retry_after_seconds"`
}

func NewExternalAnalyticsAdapter(platformName, baseURL, bearerToken string) (platform.AnalyticsAdapter, error) {
	platformName = strings.ToLower(strings.TrimSpace(platformName))
	if platformName == "" {
		return nil, fmt.Errorf("analytics source platform is required")
	}
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed == nil || !parsed.IsAbs() || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("analytics source URL must be an absolute http(s) URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("analytics source URL must not include credentials, query, or fragment")
	}
	bearerToken = strings.TrimSpace(bearerToken)
	if bearerToken == "" {
		return nil, fmt.Errorf("analytics source bearer token is required")
	}
	client := &http.Client{
		Timeout: externalAnalyticsTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
		client.Transport = defaultTransport.Clone()
	}
	return &externalAnalyticsAdapter{
		platformName: platformName,
		baseURL:      parsed,
		bearerToken:  bearerToken,
		client:       client,
	}, nil
}

func (*externalAnalyticsAdapter) AnalyticsSupport() platform.AnalyticsSupport {
	return platform.AnalyticsSupport{Account: true, Content: true}
}

func (*externalAnalyticsAdapter) UsesProviderToken() bool {
	return false
}

func (*externalAnalyticsAdapter) AnalyticsFailureMessage(status platform.AnalyticsStatus, _ string) string {
	switch status {
	case platform.AnalyticsStatusPermissionRequired:
		return "The external analytics source denied this analytics request."
	case platform.AnalyticsStatusRateLimited:
		return "The external analytics source rate limit delayed analytics collection."
	case platform.AnalyticsStatusNotFound:
		return "The external analytics source no longer returns this content."
	case platform.AnalyticsStatusUnsupported:
		return "The external analytics source does not support this analytics request."
	default:
		return "The external analytics source failed and analytics collection will be retried."
	}
}

func (a *externalAnalyticsAdapter) FetchAccountAnalytics(ctx context.Context, _ string, input platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	return a.fetch(ctx, "/analytics/account", map[string]any{
		"platform":   a.platformName,
		"account_id": input.AccountID,
	})
}

func (a *externalAnalyticsAdapter) FetchContentAnalytics(ctx context.Context, _ string, input platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	return a.fetch(ctx, "/analytics/content", map[string]any{
		"platform":     a.platformName,
		"account_id":   input.AccountID,
		"external_ids": input.ExternalIDs,
		"published_at": input.PublishedAt,
	})
}

func (a *externalAnalyticsAdapter) fetch(ctx context.Context, endpoint string, payload map[string]any) (platform.AnalyticsValues, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal analytics source request: %w", err)
	}
	requestURL := *a.baseURL
	requestURL.Path = path.Join(a.baseURL.Path, endpoint)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build analytics source request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.bearerToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, "external_source_request_failed")
	}
	defer resp.Body.Close()

	responseBody, err := readBoundedBody(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, classifyExternalAnalyticsHTTPStatus(resp.StatusCode, resp.Header)
	}

	decoder := json.NewDecoder(bytes.NewReader(responseBody))
	decoder.UseNumber()
	var envelope externalAnalyticsEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, externalAnalyticsCodeResponse)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, externalAnalyticsCodeResponse)
	}
	if status := strings.ToLower(strings.TrimSpace(envelope.Status)); status != "" {
		return nil, classifyExternalAnalyticsStatus(status, envelope.Code, envelope.RetryAfterSeconds)
	}
	return validateExternalAnalyticsMetrics(envelope.Metrics)
}

func readBoundedBody(body io.Reader) ([]byte, error) {
	limited := io.LimitReader(body, externalAnalyticsMaxBodyBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, "external_source_read_failed")
	}
	if len(data) > externalAnalyticsMaxBodyBytes {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, externalAnalyticsCodeBodyLarge)
	}
	return data, nil
}

func validateExternalAnalyticsMetrics(raw map[string]json.Number) (platform.AnalyticsValues, error) {
	if len(raw) == 0 {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, externalAnalyticsCodeResponse)
	}
	values := make(platform.AnalyticsValues, len(raw))
	for name, value := range raw {
		metricName := strings.TrimSpace(name)
		if metricName == "" || !isValidExternalMetricName(metricName) {
			return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, externalAnalyticsCodeResponse)
		}
		parsed, err := value.Int64()
		if err != nil || parsed < 0 {
			return nil, platform.NewAnalyticsError(platform.AnalyticsStatusFailed, externalAnalyticsCodeResponse)
		}
		values[metricName] = parsed
	}
	return values, nil
}

func isValidExternalMetricName(name string) bool {
	for index, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
		case index > 0 && r >= '0' && r <= '9':
		case r == '_':
		default:
			return false
		}
	}
	return true
}

func classifyExternalAnalyticsStatus(status, code string, retryAfterSeconds int64) error {
	cleanCode := sanitizeExternalAnalyticsCode(code)
	retryAfter := externalRetryAfterSeconds(retryAfterSeconds)
	switch status {
	case string(platform.AnalyticsStatusUnsupported):
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusUnsupported, Code: cleanCode}
	case string(platform.AnalyticsStatusPermissionRequired):
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusPermissionRequired, Code: cleanCode, RetryAfter: retryAfter}
	case string(platform.AnalyticsStatusRateLimited):
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusRateLimited, Code: cleanCode, RetryAfter: retryAfter}
	case string(platform.AnalyticsStatusNotFound):
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusNotFound, Code: cleanCode}
	case externalAnalyticsStatusFailed:
		if cleanCode == "" {
			cleanCode = "external_source_failed"
		}
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusFailed, Code: cleanCode, RetryAfter: retryAfter}
	default:
		return platform.NewAnalyticsError(platform.AnalyticsStatusFailed, externalAnalyticsCodeResponse)
	}
}

func classifyExternalAnalyticsHTTPStatus(statusCode int, headers http.Header) error {
	code := fmt.Sprintf("external_source_http_%d", statusCode)
	retryAfter := parseExternalRetryAfter(headers.Get("Retry-After"), time.Now().UTC())
	switch {
	case statusCode >= 300 && statusCode < 400:
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusFailed, Code: externalAnalyticsCodeRedirect}
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusPermissionRequired, Code: code, RetryAfter: retryAfter}
	case statusCode == http.StatusNotFound || statusCode == http.StatusGone:
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusNotFound, Code: code}
	case statusCode == http.StatusRequestTimeout || statusCode == http.StatusTooEarly || statusCode == http.StatusTooManyRequests:
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusRateLimited, Code: code, RetryAfter: retryAfter}
	default:
		return &platform.AnalyticsError{Status: platform.AnalyticsStatusFailed, Code: code, RetryAfter: retryAfter}
	}
}

func sanitizeExternalAnalyticsCode(code string) string {
	code = strings.TrimSpace(code)
	if externalAnalyticsCodePattern.MatchString(code) {
		return code
	}
	return ""
}

func parseExternalRetryAfter(value string, now time.Time) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		return externalRetryAfterSeconds(seconds)
	} else if strings.Trim(value, "0123456789") == "" {
		return externalAnalyticsMaxRetryAfter
	}
	if retryAt, err := http.ParseTime(value); err == nil && retryAt.After(now) {
		return min(retryAt.Sub(now), externalAnalyticsMaxRetryAfter)
	}
	return 0
}

func externalRetryAfterSeconds(seconds int64) time.Duration {
	if seconds <= 0 {
		return 0
	}
	maxSeconds := int64(externalAnalyticsMaxRetryAfter / time.Second)
	if seconds > maxSeconds {
		return externalAnalyticsMaxRetryAfter
	}
	return time.Duration(seconds) * time.Second
}
