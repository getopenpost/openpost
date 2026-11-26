package platform

import (
	"errors"
	"net/http"

	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func normalizedMetaError(t *testing.T, status int, body string) *HTTPError {
	t.Helper()
	err := normalizeMetaPublishError(NewHTTPError(status, nil, []byte(body)))
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	return providerErr
}

func TestInstagramResumePublishRejectsFailedContainerWithCuratedCode(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v25.0/container-1" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		return jsonResponse(req, `{"status_code":"ERROR","status":"Processing failed with code 2207082"}`), nil
	})}

	result, err := NewInstagramAdapter("", "", "").ResumePublish(t.Context(), "page-token", "ig-1", nil, "ig1:container-1")
	if err == nil {
		t.Fatalf("expected a classified container failure, got result %#v", result)
	}
	if result.SubmissionState != PublishSubmissionRejected || result.RetrySafety != PublishRetryNever {
		t.Fatalf("failed containers stay terminal at the job level: %#v", result)
	}
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) || providerErr.Code != "meta:media_silent_audio:2207082" {
		t.Fatalf("expected the shared classifier code, got %v", err)
	}
}

func TestInstagramResumePublishedIDRecoverySwallowsRecentMediaFailure(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
		case "/v25.0/ig-1/media":
			resp := jsonResponse(req, `{"error":{"message":"permissions went away","type":"OAuthException","code":200}}`)
			resp.StatusCode = http.StatusBadRequest
			return resp, nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	result, err := NewInstagramAdapter("", "", "").ResumePublish(t.Context(), "page-token", "ig-1", &PublishRequest{
		Content:          "Launch image",
		PlatformMediaIDs: []string{"https://media.example/image.jpg"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
	}, "ig1:container-1")
	if err != nil {
		t.Fatalf("a failed recovery lookup must not fail the accepted publish: %v", err)
	}
	if result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != "" {
		t.Fatalf("failed recovery must keep the empty ID: %#v", result)
	}
}

func TestNormalizeMetaPublishErrorClassifiesRateLimitsAndDownloadTimeout(t *testing.T) {
	for _, code := range []string{"4", "17", "32", "613", "80000", "80001", "80002", "80003", "80004", "80006"} {
		t.Run("rate_limit_"+code, func(t *testing.T) {
			providerErr := normalizedMetaError(t, http.StatusForbidden, `{"error":{"code":`+code+`,"message":"limit reached"}}`)
			require.Equal(t, http.StatusTooManyRequests, providerErr.StatusCode)
			require.Equal(t, "meta:rate_limit:"+code, providerErr.Code)
		})
	}
	timeoutErr := normalizedMetaError(t, http.StatusBadRequest, `{"error":{"code":-2,"error_subcode":2207003,"message":"media download took too long"}}`)
	require.Equal(t, http.StatusServiceUnavailable, timeoutErr.StatusCode)
	require.Equal(t, "meta:media_download_timeout:2207003", timeoutErr.Code)
}

func TestNewHTTPErrorParsesMetaBusinessUseCaseUsageCooldown(t *testing.T) {
	headers := http.Header{}
	headers.Set("X-Business-Use-Case-Usage", `{"17841400000000000":[{"type":"instagram","call_count":100,"total_cputime":25,"total_time":25,"estimated_time_to_regain_access":19}]}`)
	err := NewHTTPError(http.StatusForbidden, headers, []byte(`{"error":{"code":4}}`))
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, 19*time.Minute, providerErr.RetryAfter)

	clampedHeaders := http.Header{}
	clampedHeaders.Set("X-Business-Use-Case-Usage", `{"17841400000000000":[{"estimated_time_to_regain_access":240}]}`)
	err = NewHTTPError(http.StatusForbidden, clampedHeaders, []byte(`{"error":{"code":4}}`))
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, 60*time.Minute, providerErr.RetryAfter)
}
