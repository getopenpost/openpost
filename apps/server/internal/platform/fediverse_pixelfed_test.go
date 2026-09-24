package platform

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCompatWaitForMediaProcessingHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	started := time.Now()
	_, err := compatWaitForMediaProcessing(ctx, "http://127.0.0.1:1", "token", "media-id")
	require.ErrorIs(t, err, context.Canceled)
	require.Less(t, time.Since(started), 500*time.Millisecond)
}

func TestDetectFediverseSoftwareViaNodeInfo(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/.well-known/nodeinfo":
			return jsonResponse(req, `{"links":[{"rel":"http://nodeinfo.diaspora.software/ns/schema/2.0","href":"https://pixelfed.example/nodeinfo/2.0"}]}`), nil
		case "/nodeinfo/2.0":
			return jsonResponse(req, `{"software":{"name":"pixelfed","version":"0.12.0"}}`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, nil
		}
	})}

	if got := DetectFediverseSoftware(t.Context(), "https://pixelfed.example"); got != FediverseSoftwarePixelfed {
		t.Fatalf("expected pixelfed, got %q", got)
	}
}

func TestDetectFediverseSoftwareFallsBackToInstanceVersion(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/.well-known/nodeinfo":
			return jsonResponseWithStatus(req, http.StatusNotFound, `{}`), nil
		case "/api/v1/instance":
			return jsonResponse(req, `{"version":"2.8.0 (compatible; Friendica 2024.08)"}`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, nil
		}
	})}

	if got := DetectFediverseSoftware(t.Context(), "https://friendica.example"); got != FediverseSoftwareFriendica {
		t.Fatalf("expected friendica, got %q", got)
	}
}

func TestCompatInstanceCapabilitiesFallsBackToV1(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/api/v2/instance" {
			return jsonResponseWithStatus(req, http.StatusNotFound, `{}`), nil
		}
		if req.URL.Path == "/api/v1/instance" {
			return jsonResponse(req, `{"version":"0.11.0 (compatible; Pixelfed 0.11.0)","max_toot_chars":500,"upload_limit":15000000}`), nil
		}
		t.Fatalf("unexpected request %s", req.URL.String())
		return nil, nil
	})}

	result, err := compatInstanceCapabilities(t.Context(), "https://pixelfed.example", "token", "Pixelfed")
	if err != nil {
		t.Fatalf("compatInstanceCapabilities returned error: %v", err)
	}
	if result.Constraints["text_limit"] != 500 {
		t.Fatalf("unexpected text limit: %#v", result.Constraints)
	}
	if !strings.HasPrefix(result.Revision, "compat-v1:") {
		t.Fatalf("expected v1 revision, got %q", result.Revision)
	}
}

func TestPixelfedPublishUsesCompatTransport(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var postedValues url.Values
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.String() != "https://pixelfed.example/api/v1/statuses" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("reading form body: %v", err)
		}
		postedValues, _ = url.ParseQuery(string(body))
		return jsonResponse(req, `{"id":"101","url":"https://pixelfed.example/p/101"}`), nil
	})}

	adapter := NewPixelfedAdapter("client-id", "client-secret", "https://app.example/callback", "https://pixelfed.example")
	result, err := adapter.Publish(context.Background(), "access-token", "acct-1", &PublishRequest{
		Content: "Golden hour", IdempotencyKey: "pixelfed-op-1",
		Settings: map[string]interface{}{"visibility": "public", "sensitive": true, "language": "en"},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	require.Equal(t, "101", result.ExternalID)
	require.Equal(t, "https://pixelfed.example/p/101", result.ExternalURL)
	assertFormValue(t, postedValues, "status", "Golden hour")
	assertFormValue(t, postedValues, "visibility", "public")
	assertFormValue(t, postedValues, "sensitive", "true")
}

func TestPixelfedProfileNormalizesUsername(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"id":"7","username":"rodrigo","display_name":"Rodrigo","avatar":"https://pixelfed.example/avatars/r.jpg"}`), nil
	})}

	adapter := NewPixelfedAdapter("client-id", "client-secret", "https://app.example/callback", "https://pixelfed.example")
	profile, err := adapter.GetProfile(t.Context(), "access-token")
	if err != nil {
		t.Fatalf("GetProfile returned error: %v", err)
	}
	require.Equal(t, "rodrigo", profile.Username)
	require.Equal(t, "pixelfed", profile.CapabilityState["fediverse_software"])
}

func TestPixelfedCapabilitiesReportPixelfedRevision(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"version":"0.12.0 (compatible; Pixelfed 0.12.0)","configuration":{"statuses":{"max_characters":500,"max_media_attachments":4}}}`), nil
	})}

	adapter := NewPixelfedAdapter("client-id", "client-secret", "https://app.example/callback", "https://pixelfed.example")
	result, err := adapter.ResolveAccountPublishingCapabilities(t.Context(), "access-token", AccountCapabilityInput{})
	if err != nil {
		t.Fatalf("ResolveAccountPublishingCapabilities returned error: %v", err)
	}
	if !strings.HasPrefix(result.Revision, "pixelfed:") {
		t.Fatalf("expected pixelfed revision, got %q", result.Revision)
	}
	require.False(t, result.AvailableFeatures["focal_point"], "pixelfed must not advertise focal points")
	require.False(t, result.AvailableFeatures["quote_url"], "pixelfed must not advertise quote posts")
}

func TestValidatePixelfedMediaWarnsOnVideo(t *testing.T) {
	issues := validatePixelfedMedia([]MediaItem{{ID: "m1", MimeType: "video/mp4"}})
	require.Len(t, issues, 1)
	require.Equal(t, "pixelfed", issues[0].Provider)
	require.Equal(t, "warning", issues[0].Severity)
	require.Empty(t, validatePixelfedMedia([]MediaItem{{ID: "m1", MimeType: "image/jpeg"}}))
}
