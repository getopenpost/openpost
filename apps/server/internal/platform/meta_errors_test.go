package platform

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func normalizedMetaError(t *testing.T, status int, body string) *HTTPError {
	t.Helper()
	err := normalizeMetaPublishError(NewHTTPError(status, nil, []byte(body)))
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	return providerErr
}

func TestNormalizeMetaPublishErrorClassifiesSubcodes(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		statusCode int
		code       string
		subcode    string
	}{
		{
			name:       "190/459 checkpoint asks for a security check, not a refresh",
			body:       `{"error":{"code":190,"error_subcode":459,"message":"secret checkpoint detail"}}`,
			statusCode: http.StatusUnauthorized,
			code:       "meta:checkpoint:190:459",
			subcode:    "459",
		},
		{
			name:       "190/492 reports a lost Page role",
			body:       `{"error":{"code":190,"error_subcode":492,"message":"secret role detail"}}`,
			statusCode: http.StatusForbidden,
			code:       "meta:missing_page_role:190:492",
			subcode:    "492",
		},
		{
			name:       "190 without subcode stays an expired token",
			body:       `{"error":{"code":190,"message":"secret token detail"}}`,
			statusCode: http.StatusUnauthorized,
			code:       "meta:token_expired:190",
		},
		{
			name:       "190 with another subcode stays an expired token",
			body:       `{"error":{"code":190,"error_subcode":450}}`,
			statusCode: http.StatusUnauthorized,
			code:       "meta:token_expired:190",
			subcode:    "450",
		},
		{
			name:       "100/33 is a terminal missing object",
			body:       `{"error":{"code":100,"error_subcode":33,"message":"secret object detail"}}`,
			statusCode: http.StatusBadRequest,
			code:       "meta:nonexistent:100:33",
			subcode:    "33",
		},
		{
			name:       "100 without subcode keeps the generic mapping",
			body:       `{"error":{"code":100}}`,
			statusCode: http.StatusBadRequest,
			code:       "meta:100",
		},
		{
			name:       "2207082 keeps the silent-audio retry mapping",
			body:       `{"error":{"code":2207082,"message":"secret media detail"}}`,
			statusCode: http.StatusBadRequest,
			code:       "meta:media_silent_audio:2207082",
		},
		{
			name:       "2207085 is a terminal format rejection",
			body:       `{"error":{"code":2207085}}`,
			statusCode: http.StatusBadRequest,
			code:       "meta:media_format:2207085",
		},
		{
			name:       "other container codes are terminal media rejections",
			body:       `{"error":{"code":2207009}}`,
			statusCode: http.StatusBadRequest,
			code:       "meta:media_rejected:2207009",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			providerErr := normalizedMetaError(t, http.StatusBadRequest, test.body)
			require.Equal(t, test.statusCode, providerErr.StatusCode)
			require.Equal(t, test.code, providerErr.Code)
			require.Equal(t, test.subcode, providerErr.Subcode)
			require.NotContains(t, providerErr.Error(), "secret")
		})
	}
}

func TestNormalizeMetaPublishErrorTreatsOutagePagesAsTransient(t *testing.T) {
	providerErr := normalizedMetaError(t, http.StatusServiceUnavailable, `<html><body>Sorry, something went wrong</body></html>`)
	require.Equal(t, "meta:transient", providerErr.Code)
	require.Equal(t, http.StatusServiceUnavailable, providerErr.StatusCode)
	require.NotContains(t, providerErr.Error(), "Sorry, something went wrong")

	providerErr = normalizedMetaError(t, http.StatusTooManyRequests, `<html>busy</html>`)
	require.Equal(t, "meta:transient", providerErr.Code)

	unparseable := normalizedMetaError(t, http.StatusBadRequest, `<html>bad request page</html>`)
	require.Empty(t, unparseable.Code)
}

func TestNormalizeMetaPublishErrorLeavesNonMetaCodesAlone(t *testing.T) {
	err := normalizeMetaPublishError(&HTTPError{StatusCode: http.StatusBadRequest, Code: "instagram_processing_error"})
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, "instagram_processing_error", providerErr.Code)

	already := normalizeMetaPublishError(&HTTPError{StatusCode: http.StatusUnauthorized, Code: "meta:checkpoint:190:459", Subcode: "459"})
	require.ErrorAs(t, already, &providerErr)
	require.Equal(t, "meta:checkpoint:190:459", providerErr.Code)
	require.Equal(t, http.StatusUnauthorized, providerErr.StatusCode)
}

func TestClassifyInstagramContainerFailureUsesSameClassifier(t *testing.T) {
	tests := []struct {
		name       string
		detail     string
		statusCode int
		code       string
	}{
		{
			name:       "instagram checkpoint asks for login, not a refresh",
			detail:     "You cannot access the app till you log in to instagram.com and approve the login",
			statusCode: http.StatusUnauthorized,
			code:       "meta:checkpoint:instagram",
		},
		{
			name:       "malformed session key is a checkpoint",
			detail:     "Session key is malformed, please log in again",
			statusCode: http.StatusUnauthorized,
			code:       "meta:checkpoint:instagram",
		},
		{
			name:       "container detail carrying 2207085 maps to the format rejection",
			detail:     "The video could not be processed (2207085) for container secret-container",
			statusCode: http.StatusBadRequest,
			code:       "meta:media_format:2207085",
		},
		{
			name:       "container detail carrying 2207082 keeps the retry mapping",
			detail:     "Processing failed with code 2207082 on secret-container",
			statusCode: http.StatusBadRequest,
			code:       "meta:media_silent_audio:2207082",
		},
		{
			name:       "container (#200) maps to permission",
			detail:     "Permissions error (#200) on secret-container",
			statusCode: http.StatusForbidden,
			code:       "meta:permission:200",
		},
		{
			name:       "unrecognized detail stays a generic processing failure",
			detail:     "secret provider prose with no known code",
			statusCode: http.StatusBadRequest,
			code:       "instagram_processing_error",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := classifyInstagramContainerFailure(test.detail)
			var providerErr *HTTPError
			require.ErrorAs(t, err, &providerErr)
			require.Equal(t, test.statusCode, providerErr.StatusCode)
			require.Equal(t, test.code, providerErr.Code)
			require.NotContains(t, providerErr.Error(), "secret")
		})
	}
}

func TestEmbeddedGraphErrorsClassifyWithoutRetainingMessages(t *testing.T) {
	id, err := instagramIDFromResponse("instagram publish", []byte(`{"error":{"message":"secret detail","code":190,"error_subcode":459}}`))
	require.Empty(t, id)
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, "meta:checkpoint:190:459", providerErr.Code)
	require.Equal(t, "459", providerErr.Subcode)
	require.NotContains(t, err.Error(), "secret")

	id, err = facebookPublishedID("facebook publish", []byte(`{"error":{"message":"secret detail","code":100,"error_subcode":33}}`))
	require.Empty(t, id)
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, "meta:nonexistent:100:33", providerErr.Code)
	require.NotContains(t, err.Error(), "secret")
}

func TestMetaFailureMessagesAreCurated(t *testing.T) {
	for code, hint := range map[string]string{
		"meta:checkpoint:190:459":         "security check",
		"meta:checkpoint:instagram":       "instagram.com",
		"meta:missing_page_role:190:492":  "role on this Page",
		"meta:nonexistent:100:33":         "no longer exists",
		"meta:media_silent_audio:2207082": "volume to 0",
		"meta:media_format:2207085":       "format, duration",
		"meta:media_rejected:2207042":     "25 posts per day",
		"meta:media_rejected:2207009":     "Aspect ratio",
		"meta:media_rejected:9999999":     "Replace the media",
	} {
		message := MetaFailureMessage(code)
		require.NotEmpty(t, message, "code %s needs a curated message", code)
		require.Contains(t, message, hint)
	}
	require.Empty(t, MetaFailureMessage("meta:token_expired:190"))
	require.Empty(t, MetaFailureMessage("something-else"))
}

func TestInstagramContainerErrorPollUsesSameClassifier(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/ig-1/media":
			return jsonResponse(req, `{"id":"container-1"}`), nil
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"ERROR","status":"The video could not be processed (2207085) for secret-container"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	_, err := NewInstagramAdapter("", "", "").Publish(t.Context(), "page-token", "ig-1", &PublishRequest{
		Content:          "Launch video",
		PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
	})
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) {
		t.Fatalf("expected typed provider error, got %v", err)
	}
	if providerErr.Code != "meta:media_format:2207085" {
		t.Fatalf("container ERROR must use the shared classifier, got %#v", providerErr)
	}
	if strings.Contains(err.Error(), "secret-container") {
		t.Fatalf("container detail leaked into the error: %v", err)
	}
}

func TestInstagramContainerCheckpointPollAsksForReconnect(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/ig-1/media":
			return jsonResponse(req, `{"id":"container-1"}`), nil
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"ERROR","status":"You cannot access the app till you log in to instagram.com"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	_, err := NewInstagramAdapter("", "", "").Publish(t.Context(), "page-token", "ig-1", &PublishRequest{
		Content:          "Launch image",
		PlatformMediaIDs: []string{"https://media.example/image.jpg"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
	})
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) {
		t.Fatalf("expected typed provider error, got %v", err)
	}
	if providerErr.Code != "meta:checkpoint:instagram" || providerErr.StatusCode != http.StatusUnauthorized {
		t.Fatalf("checkpoint container must classify as reconnect, got %#v", providerErr)
	}
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
