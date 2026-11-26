package platform

import (
	"net/http"
	"testing"
	"time"
)

func TestYouTubeProcessedScheduledVideoRetainsProviderSchedule(t *testing.T) {
	original := httpClient
	defer func() { httpClient = original }()
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(r, `{"items":[{"id":"scheduled-video","status":{"uploadStatus":"processed"}}]}`), nil
	})}
	result, err := NewYouTubeAdapter("", "", "").Publish(t.Context(), "token", "channel", &PublishRequest{
		PlatformMediaIDs: []string{"scheduled-video"}, Media: []MediaItem{{MimeType: "video/mp4"}},
		Settings: map[string]any{"privacy": "private", "publish_at": time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)},
	})
	if err != nil || result.SubmissionState != PublishSubmissionAccepted || result.ProviderState != "scheduled" {
		t.Fatalf("accepted schedule must stay distinct from a live video: %+v %v", result, err)
	}
}
