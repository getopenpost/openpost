package platform

import (
	"errors"
	"net/http"

	"testing"
)

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
