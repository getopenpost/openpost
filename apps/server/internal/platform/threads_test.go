package platform

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestThreadsAuthorizationRequestsReplyReadAccess(t *testing.T) {
	authURL, _ := NewThreadsAdapter("client", "secret", "https://app.example/callback").GenerateAuthURL("state")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(parsed.Query().Get("scope"), "threads_read_replies") {
		t.Fatal("Threads authorization must request permission to read incoming replies")
	}
}

func TestThreadsExchangeCodeRecordsGrantedOptionalScopes(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "graph.threads.net" {
			if req.URL.Path == "/oauth/access_token" {
				return jsonResponse(req, `{"access_token":"short","user_id":12345}`), nil
			}
			if req.URL.Path == "/access_token" {
				return jsonResponse(req, `{"access_token":"long","expires_in":5184000}`), nil
			}
		}
		t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		return nil, nil
	})}

	token, err := NewThreadsAdapter("client", "secret", "https://app.example/callback").
		ExchangeCode(context.Background(), "code", nil)
	if err != nil {
		t.Fatalf("ExchangeCode returned error: %v", err)
	}
	if token.AccessToken != "long" || !strings.Contains(token.Extra["scope"], "threads_manage_insights") || !strings.Contains(token.Extra["scope"], "threads_location_tagging") {
		t.Fatalf("expected token with analytics and location scopes, got %#v", token)
	}
}

func TestThreadsPublishMixedMediaCarousel(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	childCount := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodPost && req.URL.String() == "https://graph.threads.net/v1.0/user-1/threads":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading container body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing container body: %v", err)
			}
			if form.Get(oauthParamAccessToken) != "threads-token" {
				t.Fatalf("unexpected access token in %#v", form)
			}
			if form.Get("is_carousel_item") == "true" {
				childCount++
				if childCount == 1 && (form.Get("media_type") != "IMAGE" || form.Get("image_url") != "https://cdn.example/image.jpg") {
					t.Fatalf("unexpected image item form %#v", form)
				}
				if childCount == 2 && (form.Get("media_type") != "VIDEO" || form.Get("video_url") != "https://cdn.example/video.mp4") {
					t.Fatalf("unexpected video item form %#v", form)
				}
				return jsonResponse(req, `{"id":"`+[]string{"child-1", "child-2"}[childCount-1]+`"}`), nil
			}
			if form.Get("media_type") != "CAROUSEL" || form.Get("children") != "child-1,child-2" || form.Get(jsonFieldText) != "Launch" {
				t.Fatalf("unexpected carousel form %#v", form)
			}
			return jsonResponse(req, `{"id":"carousel-1"}`), nil
		case req.Method == http.MethodGet && (req.URL.Path == "/v1.0/child-1" || req.URL.Path == "/v1.0/child-2" || req.URL.Path == "/v1.0/carousel-1"):
			return jsonResponse(req, `{"status":"FINISHED"}`), nil
		case req.Method == http.MethodPost && req.URL.String() == "https://graph.threads.net/v1.0/user-1/threads_publish":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading publish body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil || form.Get("creation_id") != "carousel-1" {
				t.Fatalf("unexpected publish form %#v err=%v", form, err)
			}
			return jsonResponse(req, `{"id":"thread-1"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	id, err := NewThreadsAdapter("", "", "").Publish(context.Background(), "threads-token", "user-1", &PublishRequest{
		Content:          "Launch",
		PlatformMediaIDs: []string{"https://cdn.example/image.jpg", "https://cdn.example/video.mp4"},
		Media:            []MediaItem{{MimeType: "image/jpeg"}, {MimeType: "video/mp4"}},
	})

	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if id.ExternalID != "thread-1" {
		t.Fatalf("expected thread-1, got %q", id)
	}
}
