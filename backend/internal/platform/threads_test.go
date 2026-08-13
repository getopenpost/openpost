package platform

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

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

func TestThreadsListCommentsMapsReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || req.URL.String() != "https://graph.threads.net/v1.0/thread-1/replies?fields=id%2Ctext%2Cusername%2Ctimestamp%2Chide_status&access_token=threads-token" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		return jsonResponse(req, `{"data":[{"id":"reply-1","text":"Nice thread","username":"rita","timestamp":"2026-07-04T10:00:00+0000","hide_status":"HIDDEN"}]}`), nil
	})}

	comments, err := NewThreadsAdapter("", "", "").ListComments(context.Background(), "threads-token", "user-1", "thread-1")
	if err != nil {
		t.Fatalf("ListComments returned error: %v", err)
	}
	if len(comments) != 1 {
		t.Fatalf("expected one comment, got %#v", comments)
	}
	comment := comments[0]
	if comment.ID != "reply-1" || comment.AuthorName != "rita" || comment.Text != "Nice thread" || !comment.Hidden || !comment.CanReply || !comment.CanHide || comment.CanDelete {
		t.Fatalf("unexpected comment mapping: %#v", comment)
	}
}

func TestThreadsReplyAndHideComment(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodPost && req.URL.String() == "https://graph.threads.net/v1.0/user-1/threads":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading reply body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing reply body: %v", err)
			}
			if form.Get(jsonFieldText) != "Thanks" || form.Get("reply_to_id") != "reply-1" || form.Get("media_type") != "TEXT" || form.Get(oauthParamAccessToken) != "threads-token" {
				t.Fatalf("unexpected reply form %#v", form)
			}
			return jsonResponse(req, `{"id":"creation-1"}`), nil
		case req.Method == http.MethodGet && req.URL.String() == "https://graph.threads.net/v1.0/creation-1?fields=status,error_message":
			if req.Header.Get(headerAuthorization) != bearerPrefix+"threads-token" {
				t.Fatalf("unexpected status auth header %q", req.Header.Get(headerAuthorization))
			}
			return jsonResponse(req, `{"status":"FINISHED"}`), nil
		case req.Method == http.MethodPost && req.URL.String() == "https://graph.threads.net/v1.0/user-1/threads_publish":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading publish body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing publish body: %v", err)
			}
			if form.Get("creation_id") != "creation-1" || form.Get(oauthParamAccessToken) != "threads-token" {
				t.Fatalf("unexpected publish form %#v", form)
			}
			return jsonResponse(req, `{"id":"reply-post-1"}`), nil
		case req.Method == http.MethodPost && req.URL.String() == "https://graph.threads.net/v1.0/reply-1/manage_reply":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading hide body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing hide body: %v", err)
			}
			if form.Get("hide") != "true" || form.Get(oauthParamAccessToken) != "threads-token" {
				t.Fatalf("unexpected hide form %#v", form)
			}
			return jsonResponse(req, `{"success":true}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewThreadsAdapter("", "", "")
	replyID, err := adapter.ReplyToComment(context.Background(), "threads-token", "user-1", "reply-1", " Thanks ")
	if err != nil {
		t.Fatalf("ReplyToComment returned error: %v", err)
	}
	if replyID != "reply-post-1" {
		t.Fatalf("expected reply post ID, got %q", replyID)
	}
	if err := adapter.HideComment(context.Background(), "threads-token", "user-1", "reply-1"); err != nil {
		t.Fatalf("HideComment returned error: %v", err)
	}
}

func TestThreadsPublishContainerRetriesTypedPropagationError(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	attempts := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.String() != "https://graph.threads.net/v1.0/user-1/threads_publish" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		attempts++
		if attempts == 1 {
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"error":{"code":24}}`)),
				Request:    req,
			}, nil
		}
		return jsonResponse(req, `{"id":"thread-1"}`), nil
	})}

	id, err := NewThreadsAdapter("", "", "").publishContainer(
		context.Background(),
		"threads-token",
		"user-1",
		"creation-1",
	)

	if err != nil {
		t.Fatalf("publishContainer returned error: %v", err)
	}
	if id != "thread-1" || attempts != 2 {
		t.Fatalf("expected one code-24 retry and thread-1, got id=%q attempts=%d", id, attempts)
	}
}

func TestThreadsDeleteCommentUnsupported(t *testing.T) {
	err := NewThreadsAdapter("", "", "").DeleteComment(context.Background(), "threads-token", "user-1", "reply-1")
	if !errors.Is(err, ErrUnsupportedCommentAction) {
		t.Fatalf("expected unsupported comment action, got %v", err)
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

func TestThreadsSettingsUseOfficialPollAndSpoilerFields(t *testing.T) {
	payload := map[string]string{}
	err := applyThreadsSettings(payload, &PublishRequest{Settings: map[string]interface{}{
		"poll_options":  "One\nTwo\nThree",
		"reply_control": "followers_only",
		"topic_tag":     "OpenPost",
	}})
	if err != nil {
		t.Fatalf("applyThreadsSettings returned error: %v", err)
	}
	if payload["reply_control"] != "followers_only" || payload["topic_tag"] != "OpenPost" {
		t.Fatalf("unexpected Threads settings payload %#v", payload)
	}
	var poll map[string]string
	if err := json.Unmarshal([]byte(payload["poll_attachment"]), &poll); err != nil {
		t.Fatalf("decoding poll attachment: %v", err)
	}
	want := map[string]string{"option_a": "One", "option_b": "Two", "option_c": "Three"}
	if len(poll) != len(want) {
		t.Fatalf("unexpected poll attachment %#v", poll)
	}
	for key, value := range want {
		if poll[key] != value {
			t.Fatalf("unexpected poll attachment %#v", poll)
		}
	}

	err = applyThreadsSettings(map[string]string{}, &PublishRequest{Settings: map[string]interface{}{
		"url":          "https://example.com",
		"poll_options": "One\nTwo",
	}})
	if err == nil || !strings.Contains(err.Error(), "link attachment") {
		t.Fatalf("expected poll/link conflict, got %v", err)
	}

	err = applyThreadsSettings(map[string]string{}, &PublishRequest{Settings: map[string]interface{}{
		"poll_options": "Only one",
	}})
	if err == nil || !strings.Contains(err.Error(), "2-4 options") {
		t.Fatalf("expected poll option count error, got %v", err)
	}
}

func TestThreadsSettingsUseOfficialTextAndGIFAttachmentObjects(t *testing.T) {
	textPayload := map[string]string{}
	err := applyThreadsSettings(textPayload, &PublishRequest{Settings: map[string]interface{}{
		"text_attachment_plaintext": "Long-form note",
		"text_attachment_link_url":  "https://example.com/source",
	}})
	if err != nil {
		t.Fatalf("applying text attachment settings: %v", err)
	}
	var textAttachment map[string]string
	if err := json.Unmarshal([]byte(textPayload["text_attachment"]), &textAttachment); err != nil {
		t.Fatalf("decoding text attachment: %v", err)
	}
	if textAttachment["plaintext"] != "Long-form note" || textAttachment["link_attachment_url"] != "https://example.com/source" {
		t.Fatalf("unexpected text attachment %#v", textAttachment)
	}

	gifPayload := map[string]string{}
	err = applyThreadsSettings(gifPayload, &PublishRequest{Settings: map[string]interface{}{"gif_id": "giphy-123"}})
	if err != nil {
		t.Fatalf("applying GIF attachment settings: %v", err)
	}
	var gifAttachment map[string]string
	if err := json.Unmarshal([]byte(gifPayload["gif_attachment"]), &gifAttachment); err != nil {
		t.Fatalf("decoding GIF attachment: %v", err)
	}
	if gifAttachment["gif_id"] != "giphy-123" || gifAttachment["provider"] != "GIPHY" {
		t.Fatalf("unexpected GIF attachment %#v", gifAttachment)
	}

	err = applyThreadsSettings(map[string]string{}, &PublishRequest{Settings: map[string]interface{}{
		"text_attachment_plaintext": "Long-form note",
		"gif_id":                    "giphy-123",
	}})
	if err == nil || !strings.Contains(err.Error(), "cannot be combined") {
		t.Fatalf("expected text/GIF conflict, got %v", err)
	}
}

func TestThreadsPublishesMediaSpoilerAsBoolean(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

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
			if form.Get("is_spoiler_media") != "true" || form.Get("image_url") != "https://cdn.example/image.jpg" {
				t.Fatalf("unexpected spoiler form %#v", form)
			}
			return jsonResponse(req, `{"id":"creation-1"}`), nil
		case req.Method == http.MethodGet && req.URL.Path == "/v1.0/creation-1":
			return jsonResponse(req, `{"status":"FINISHED"}`), nil
		case req.Method == http.MethodPost && req.URL.String() == "https://graph.threads.net/v1.0/user-1/threads_publish":
			return jsonResponse(req, `{"id":"thread-1"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	_, err := NewThreadsAdapter("", "", "").Publish(context.Background(), "threads-token", "user-1", &PublishRequest{
		Content:          "Spoiler",
		PlatformMediaIDs: []string{"https://cdn.example/image.jpg"},
		Media:            []MediaItem{{MimeType: "image/jpeg"}},
		Settings:         map[string]interface{}{"spoiler": true},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
}

func TestThreadsSearchesPublishingLocations(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || req.URL.Path != "/v1.0/location_search" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if req.URL.Query().Get("q") != "Lisbon" || req.URL.Query().Get("query") != "" || req.URL.Query().Get("access_token") != "threads-token" {
			t.Fatalf("unexpected location query %#v", req.URL.Query())
		}
		return jsonResponse(req, `{"data":[{"id":"location-1","name":"Lisbon","city":"Lisbon","country":"Portugal"}],"paging":{"cursors":{"after":"next"}}}`), nil
	})}

	page, err := NewThreadsAdapter("", "", "").SearchPublishingOptions(context.Background(), "threads-token", PublishingOptionsInput{
		Source: "threads_locations",
		Search: "Lisbon",
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("SearchPublishingOptions returned error: %v", err)
	}
	if page.NextCursor != "next" || len(page.Options) != 1 || page.Options[0].Value != "location-1" || page.Options[0].Label != "Lisbon · Lisbon, Portugal" {
		t.Fatalf("unexpected locations page %#v", page)
	}
}

func TestThreadsLocationSearchWaitsForAQuery(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		t.Fatalf("empty location search should not call Threads: %s %s", req.Method, req.URL.String())
		return nil, nil
	})}

	page, err := NewThreadsAdapter("", "", "").SearchPublishingOptions(context.Background(), "threads-token", PublishingOptionsInput{
		Source: "threads_locations",
		Search: "   ",
		Limit:  100,
	})
	if err != nil {
		t.Fatalf("SearchPublishingOptions returned error: %v", err)
	}
	if len(page.Options) != 0 || page.NextCursor != "" {
		t.Fatalf("expected an empty location page, got %#v", page)
	}
}
