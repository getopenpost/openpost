package platform

import (
	"fmt"
	"io"
	"net/http"
	"net/url"

	"strings"
	"testing"
)

func TestFacebookPublishPreservesPhotoAltText(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	for _, tc := range []struct {
		name      string
		profile   string
		mediaURLs []string
		altTexts  []string
		wantAlts  []string
		finalEdge string
	}{
		{name: "single photo", mediaURLs: []string{"https://media.example/one.jpg"}, altTexts: []string{"A red bicycle beside a café"}, wantAlts: []string{"A red bicycle beside a café"}},
		{name: "no alt text", mediaURLs: []string{"https://media.example/one.jpg"}, wantAlts: []string{""}},
		{name: "multiple photos", mediaURLs: []string{"https://media.example/one.jpg", "https://media.example/two.jpg", "https://media.example/three.jpg"}, altTexts: []string{"A red bicycle", "A blue bicycle"}, wantAlts: []string{"A red bicycle", "A blue bicycle", ""}, finalEdge: "feed"},
		{name: "photo story", profile: "story", mediaURLs: []string{"https://media.example/one.jpg"}, altTexts: []string{"A bicycle at sunset"}, wantAlts: []string{"A bicycle at sunset"}, finalEdge: "photo_stories"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			photoCalls, finalCalls := 0, 0
			httpClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				if request.Method != http.MethodPost {
					t.Fatalf("unexpected method %s", request.Method)
				}
				if err := request.ParseForm(); err != nil {
					t.Fatal(err)
				}
				switch request.URL.Path {
				case "/v25.0/page-1/photos":
					index := photoCalls
					photoCalls++
					if index >= len(tc.mediaURLs) {
						t.Fatalf("unexpected extra photo upload")
					}
					if got := request.PostForm.Get("url"); got != tc.mediaURLs[index] {
						t.Errorf("photo %d URL = %q, want %q", index, got, tc.mediaURLs[index])
					}
					if got := request.PostForm.Get("alt_text_custom"); got != tc.wantAlts[index] {
						t.Errorf("photo %d alt text = %q, want %q", index, got, tc.wantAlts[index])
					}
					if tc.wantAlts[index] == "" && request.PostForm.Has("alt_text_custom") {
						t.Error("empty alt text must be omitted")
					}
					return jsonResponse(request, fmt.Sprintf(`{"id":"photo-%d"}`, index+1)), nil
				case "/v25.0/page-1/" + tc.finalEdge:
					finalCalls++
					return jsonResponse(request, `{"id":"post-1"}`), nil
				default:
					t.Fatalf("unexpected request %s", request.URL.Path)
					return nil, nil
				}
			})}
			media := make([]MediaItem, len(tc.mediaURLs))
			for index := range media {
				media[index] = MediaItem{MimeType: "image/jpeg"}
			}
			_, err := NewFacebookAdapter("", "", "").Publish(t.Context(), "token", "page-1", &PublishRequest{
				Content: "Bicycles", Profile: tc.profile, PlatformMediaIDs: tc.mediaURLs, MediaAltTexts: tc.altTexts, Media: media,
			})
			if err != nil {
				t.Fatal(err)
			}
			if photoCalls != len(tc.mediaURLs) {
				t.Errorf("photo uploads = %d, want %d", photoCalls, len(tc.mediaURLs))
			}
			wantFinalCalls := 0
			if tc.finalEdge != "" {
				wantFinalCalls = 1
			}
			if finalCalls != wantFinalCalls {
				t.Errorf("final publications = %d, want %d", finalCalls, wantFinalCalls)
			}
		})
	}
}

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
