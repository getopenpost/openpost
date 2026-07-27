package platform

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestMastodonPublishAppliesStatusSettings(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var postedValues url.Values
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.String() != "https://mastodon.example/api/v1/statuses" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if req.Header.Get(headerAuthorization) != "Bearer access-token" {
			t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
		}
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("reading form body: %v", err)
		}
		postedValues, err = url.ParseQuery(string(body))
		if err != nil {
			t.Fatalf("parsing form body: %v", err)
		}
		return jsonResponse(req, `{"id":"scheduled-1"}`), nil
	})}

	adapter := NewMastodonAdapter("client-id", "client-secret", "https://app.example/callback", "https://mastodon.example")
	externalID, err := adapter.Publish(context.Background(), "access-token", "acct-1", &PublishRequest{
		Content: "Launch post",
		Settings: map[string]interface{}{
			"visibility":              "unlisted",
			"spoiler_text":            "Launch details",
			"sensitive":               true,
			"language":                "pt",
			"poll_options":            "One\nTwo\nThree",
			"poll_expires_in_seconds": float64(3600),
			"poll_multiple":           true,
			"poll_hide_totals":        true,
		},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if externalID != "scheduled-1" {
		t.Fatalf("expected scheduled id, got %q", externalID)
	}

	assertFormValue(t, postedValues, "status", "Launch post")
	assertFormValue(t, postedValues, "visibility", "unlisted")
	assertFormValue(t, postedValues, "spoiler_text", "Launch details")
	assertFormValue(t, postedValues, "sensitive", "true")
	assertFormValue(t, postedValues, "language", "pt")
	if postedValues.Has("scheduled_at") {
		t.Fatalf("OpenPost scheduling must not be forwarded to Mastodon: %#v", postedValues)
	}
	assertFormValue(t, postedValues, "poll[expires_in]", "3600")
	assertFormValue(t, postedValues, "poll[multiple]", "true")
	assertFormValue(t, postedValues, "poll[hide_totals]", "true")
	if got := postedValues["poll[options][]"]; strings.Join(got, ",") != "One,Two,Three" {
		t.Fatalf("unexpected poll options: %#v", got)
	}
}

func TestMastodonPublishRejectsPollWithMedia(t *testing.T) {
	adapter := NewMastodonAdapter("client-id", "client-secret", "https://app.example/callback", "https://mastodon.example")
	_, err := adapter.Publish(context.Background(), "access-token", "acct-1", &PublishRequest{
		Content:          "Launch post",
		PlatformMediaIDs: []string{"media-1"},
		Settings: map[string]interface{}{
			"poll_options": "One\nTwo",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "polls cannot be combined with media") {
		t.Fatalf("expected poll/media conflict, got %v", err)
	}
}

func assertFormValue(t *testing.T, values url.Values, key, want string) {
	t.Helper()
	if got := values.Get(key); got != want {
		t.Fatalf("expected %s=%q, got %q in %#v", key, want, got, values)
	}
}
