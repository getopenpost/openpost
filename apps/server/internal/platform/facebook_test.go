package platform

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestFacebookRejectsProviderUploadURLBeforeSendingCredentials(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		return jsonResponse(req, `{"video_id":"video-1","upload_url":"https://rupload.facebook.com@evil.example/video-1"}`), nil
	})}

	_, err := NewFacebookAdapter("", "", "").Publish(t.Context(), "page-token", "page-1", &PublishRequest{
		Profile:          "short_video",
		OutputProfile:    "facebook.reel",
		PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
	})
	if err == nil || !strings.Contains(err.Error(), "invalid upload URL") {
		t.Fatalf("expected invalid upload URL error, got %v", err)
	}
	if requests != 1 {
		t.Fatalf("credentials were sent after invalid upload URL, requests=%d", requests)
	}
}

func TestFacebookVideoPollKeepsExistingUploadAfterTransientFailure(t *testing.T) {
	originalClient := httpClient
	originalDelay := facebookVideoUploadPollDelay
	defer func() {
		httpClient = originalClient
		facebookVideoUploadPollDelay = originalDelay
	}()
	facebookVideoUploadPollDelay = 0

	statusCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/page-1/video_reels"):
			body, _ := io.ReadAll(req.Body)
			form, _ := url.ParseQuery(string(body))
			if form.Get("upload_phase") == "start" {
				return jsonResponse(req, `{"video_id":"video-1","upload_url":"https://rupload.facebook.com/video-1"}`), nil
			}
			return jsonResponse(req, `{"id":"reel-1"}`), nil
		case req.URL.Host == "rupload.facebook.com":
			return jsonResponse(req, `{"success":true}`), nil
		case strings.HasSuffix(req.URL.Path, "/video-1"):
			statusCalls++
			if statusCalls == 1 {
				return &http.Response{StatusCode: http.StatusServiceUnavailable, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":{"code":2}}`)), Request: req}, nil
			}
			return jsonResponse(req, `{"status":{"video_status":"ready","processing_phase":{"status":"complete"}}}`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, nil
		}
	})}

	_, err := NewFacebookAdapter("", "", "").Publish(t.Context(), "page-token", "page-1", &PublishRequest{
		Profile:          "short_video",
		OutputProfile:    "facebook.reel",
		PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if statusCalls != 2 {
		t.Fatalf("expected two status calls, got %d", statusCalls)
	}
}

func TestFacebookVideoResumeSurfacesConfirmedProviderRejection(t *testing.T) {
	original := httpClient
	defer func() { httpClient = original }()
	for _, stage := range []string{"status", "finish"} {
		t.Run(stage, func(t *testing.T) {
			httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if stage == "finish" && r.Method == http.MethodGet {
					return jsonResponse(r, `{"status":{"video_status":"ready","processing_phase":{"status":"complete"}}}`), nil
				}
				response := jsonResponse(r, `{"error":{"code":10}}`)
				response.StatusCode = http.StatusForbidden
				return response, nil
			})}
			result, err := NewFacebookAdapter("", "", "").ResumePublish(t.Context(), "token", "page", &PublishRequest{OutputProfile: "facebook.reel"}, "fb1:processing:video-1")
			if err == nil || result.SubmissionState != PublishSubmissionRejected || result.ProviderReference == "" {
				t.Fatalf("confirmed %s rejection must retain identity and stop reconciliation: %+v %v", stage, result, err)
			}
		})
	}
}
