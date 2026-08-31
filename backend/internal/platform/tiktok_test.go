package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestTikTokGenerateAuthURL(t *testing.T) {
	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/api/v1/accounts/tiktok/callback")

	authURL, _ := adapter.GenerateAuthURL("state-123")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}

	if parsed.Scheme != "https" || parsed.Host != "www.tiktok.com" || parsed.Path != "/v2/auth/authorize/" {
		t.Fatalf("unexpected auth url %s", authURL)
	}
	query := parsed.Query()
	if query.Get("client_key") != "client-key" {
		t.Fatalf("expected client_key, got %q", query.Get("client_key"))
	}
	if query.Get("redirect_uri") != "https://app.example/api/v1/accounts/tiktok/callback" {
		t.Fatalf("unexpected redirect uri %q", query.Get("redirect_uri"))
	}
	if query.Get("response_type") != "code" {
		t.Fatalf("unexpected response_type %q", query.Get("response_type"))
	}
	if query.Get("state") != "state-123" {
		t.Fatalf("unexpected state %q", query.Get("state"))
	}
	if !strings.Contains(query.Get("scope"), "video.publish") {
		t.Fatalf("expected video.publish scope, got %q", query.Get("scope"))
	}
	if !strings.Contains(query.Get("scope"), "user.info.stats") || !strings.Contains(query.Get("scope"), "video.list") {
		t.Fatalf("expected analytics read scopes, got %q", query.Get("scope"))
	}
}

func TestTikTokUploadCapabilityDoesNotRequireCreatorInfo(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		t.Fatalf("upload capability resolution must not call TikTok: %s %s", req.Method, req.URL.String())
		return nil, nil
	})}

	result, err := NewTikTokAdapter("", "", "").ResolveAccountPublishingCapabilities(
		context.Background(),
		"access",
		AccountCapabilityInput{Settings: map[string]interface{}{"content_posting_method": "UPLOAD"}},
	)
	if err != nil {
		t.Fatalf("ResolveAccountPublishingCapabilities returned error: %v", err)
	}
	if result.Revision != "tiktok-upload-v1" || len(result.Options) != 0 {
		t.Fatalf("unexpected upload capability result %#v", result)
	}
}

func TestTikTokExchangeCodeAndProfile(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokTokenURL:
			if req.Method != http.MethodPost {
				t.Fatalf("unexpected token method %s", req.Method)
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading token body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing token form: %v", err)
			}
			if form.Get("client_key") != "client-key" || form.Get(oauthParamClientSecret) != "client-secret" {
				t.Fatalf("unexpected client credentials in form: %s", string(body))
			}
			if form.Get(grantType) != oauthGrantAuthCode || form.Get(oauthParamCode) != "auth-code" {
				t.Fatalf("unexpected grant/code in form: %s", string(body))
			}
			return jsonResponse(req, `{"access_token":"access","refresh_token":"refresh","expires_in":86400,"token_type":"Bearer","scope":"user.info.basic,video.publish","open_id":"open-1"}`), nil
		case tiktokUserInfoURL:
			if req.Header.Get(headerAuthorization) != bearerPrefix+"access" {
				t.Fatalf("unexpected profile auth header %q", req.Header.Get(headerAuthorization))
			}
			return jsonResponse(req, `{"data":{"user":{"open_id":"open-1","display_name":"Creator","username":"creator","avatar_url":"https://cdn.tiktok.example/avatar.jpg"}},"error":{"code":"ok","message":"","log_id":"log"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback")
	token, err := adapter.ExchangeCode(context.Background(), "auth-code", nil)
	if err != nil {
		t.Fatalf("ExchangeCode returned error: %v", err)
	}
	if token.AccessToken != "access" || token.RefreshToken != "refresh" || token.Extra["open_id"] != "open-1" {
		t.Fatalf("unexpected token result: %#v", token)
	}

	profile, err := adapter.GetProfile(context.Background(), token.AccessToken)
	if err != nil {
		t.Fatalf("GetProfile returned error: %v", err)
	}
	if profile.ID != "open-1" || profile.Username != "creator" || profile.DisplayName != "Creator" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
	if profile.AvatarURL != "https://cdn.tiktok.example/avatar.jpg" {
		t.Fatalf("unexpected profile avatar: %#v", profile)
	}
}

func TestTikTokPublishDirectVideoFromPublicURL(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var initPayload map[string]any
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get(headerAuthorization) != bearerPrefix+"access" {
			t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
		}
		switch req.URL.String() {
		case tiktokCreatorInfoURL:
			return jsonResponse(req, `{"data":{"privacy_level_options":["SELF_ONLY","PUBLIC_TO_EVERYONE"]},"error":{"code":"ok"}}`), nil
		case tiktokVideoInitURL:
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading init body: %v", err)
			}
			if err := json.Unmarshal(body, &initPayload); err != nil {
				t.Fatalf("decoding init payload: %v", err)
			}
			return jsonResponse(req, `{"data":{"publish_id":"publish-1"},"error":{"code":"ok"}}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"PUBLISH_COMPLETE","publicly_available_post_id":["video-1"]},"error":{"code":"ok"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback")
	request := &PublishRequest{
		Content:          "Launch video",
		PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
		Settings: map[string]interface{}{
			"content_posting_method": "DIRECT_POST",
			"privacy_level":          "PUBLIC_TO_EVERYONE",
		},
	}
	var checkpoints []PublishResult
	request.SetWriteFence(func(PublishResult) error { return nil }, func(result PublishResult) error {
		checkpoints = append(checkpoints, result)
		return nil
	})
	externalID, err := adapter.Publish(context.Background(), "access", "open-1", request)
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if externalID.ExternalID != "video-1" {
		t.Fatalf("expected video id, got %q", externalID)
	}
	if len(checkpoints) != 2 || checkpoints[0].SubmissionState != PublishSubmissionPending ||
		checkpoints[0].ProviderReference != "publish-1" || checkpoints[1].SubmissionState != PublishSubmissionAccepted {
		t.Fatalf("unexpected durable publish checkpoints: %#v", checkpoints)
	}

	postInfo, ok := initPayload["post_info"].(map[string]any)
	if !ok {
		t.Fatalf("missing post_info payload: %#v", initPayload)
	}
	if postInfo["privacy_level"] != "PUBLIC_TO_EVERYONE" || postInfo["title"] != "Launch video" {
		t.Fatalf("unexpected post_info: %#v", postInfo)
	}
	sourceInfo, ok := initPayload["source_info"].(map[string]any)
	if !ok {
		t.Fatalf("missing source_info payload: %#v", initPayload)
	}
	if sourceInfo["source"] != "PULL_FROM_URL" || sourceInfo["video_url"] != "https://media.example/video.mp4" {
		t.Fatalf("unexpected source_info: %#v", sourceInfo)
	}
}

func TestTikTokPublishUploadInboxVideoFromPublicURLUsesInboxEndpoint(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var initPayload map[string]any
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get(headerAuthorization) != bearerPrefix+"access" {
			t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
		}
		switch req.URL.String() {
		case tiktokVideoInboxInitURL:
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading inbox init body: %v", err)
			}
			if err := json.Unmarshal(body, &initPayload); err != nil {
				t.Fatalf("decoding inbox init payload: %v", err)
			}
			return jsonResponse(req, `{"data":{"publish_id":"publish-inbox-1"},"error":{"code":"ok"}}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback")
	externalID, err := adapter.Publish(context.Background(), "access", "open-1", &PublishRequest{
		Content:          "Launch video",
		Settings:         map[string]interface{}{"content_posting_method": "UPLOAD"},
		PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if externalID.ExternalID != "publish-inbox-1" {
		t.Fatalf("expected publish id, got %q", externalID)
	}
	sourceInfo, ok := initPayload["source_info"].(map[string]any)
	if !ok {
		t.Fatalf("missing source_info payload: %#v", initPayload)
	}
	if sourceInfo["source"] != "PULL_FROM_URL" || sourceInfo["video_url"] != "https://media.example/video.mp4" {
		t.Fatalf("unexpected source_info: %#v", sourceInfo)
	}
	if _, ok := initPayload["post_info"]; ok {
		t.Fatalf("upload inbox payload should not include direct-post post_info: %#v", initPayload)
	}
}

func TestTikTokUploadMediaWithMetadataUploadsVideoFileToInbox(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var initPayload map[string]any
	var uploadBody string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokVideoInboxInitURL:
			if req.Header.Get(headerAuthorization) != bearerPrefix+"access" {
				t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading init body: %v", err)
			}
			if err := json.Unmarshal(body, &initPayload); err != nil {
				t.Fatalf("decoding init payload: %v", err)
			}
			return jsonResponse(req, `{"data":{"publish_id":"publish-file-1","upload_url":"https://upload.tiktok.example/video?upload_id=1&upload_token=tok"},"error":{"code":"ok"}}`), nil
		case "https://upload.tiktok.example/video?upload_id=1&upload_token=tok":
			if req.Method != http.MethodPut {
				t.Fatalf("unexpected upload method %s", req.Method)
			}
			if req.Header.Get(headerContentType) != "video/mp4" {
				t.Fatalf("unexpected content type %q", req.Header.Get(headerContentType))
			}
			if req.Header.Get("Content-Range") != "bytes 0-9/10" {
				t.Fatalf("unexpected content range %q", req.Header.Get("Content-Range"))
			}
			if req.Header.Get("Content-Length") != "10" {
				t.Fatalf("unexpected content length %q", req.Header.Get("Content-Length"))
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading upload body: %v", err)
			}
			uploadBody = string(body)
			return jsonResponseWithStatus(req, http.StatusOK, ""), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback")
	publishID, err := adapter.UploadMediaWithMetadata(context.Background(), "access", "open-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Size:     10,
		Settings: map[string]interface{}{"content_posting_method": "UPLOAD"},
		Reader:   strings.NewReader("0123456789"),
	})
	if err != nil {
		t.Fatalf("UploadMediaWithMetadata returned error: %v", err)
	}
	if publishID != "publish-file-1" {
		t.Fatalf("expected publish ID, got %q", publishID)
	}
	sourceInfo, ok := initPayload["source_info"].(map[string]any)
	if !ok {
		t.Fatalf("missing source_info payload: %#v", initPayload)
	}
	if sourceInfo["source"] != "FILE_UPLOAD" || sourceInfo["video_size"] != float64(10) || sourceInfo["chunk_size"] != float64(10) || sourceInfo["total_chunk_count"] != float64(1) {
		t.Fatalf("unexpected source_info: %#v", sourceInfo)
	}
	if uploadBody != "0123456789" {
		t.Fatalf("unexpected upload body %q", uploadBody)
	}
}

func TestTikTokPublishRequiresHTTPSVideoURL(t *testing.T) {
	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback")
	_, err := adapter.Publish(context.Background(), "access", "open-1", &PublishRequest{
		Content:          "Launch video",
		PlatformMediaIDs: []string{"http://media.example/video.mp4"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
	})
	if err == nil || !strings.Contains(err.Error(), "publicly-accessible HTTPS") {
		t.Fatalf("expected HTTPS URL error, got %v", err)
	}
}

func TestTikTokPublishUploadPhotoUsesUploadContractWithoutDirectPostSettings(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var initPayload map[string]any
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokContentInitURL:
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading photo init body: %v", err)
			}
			if err := json.Unmarshal(body, &initPayload); err != nil {
				t.Fatalf("decoding photo init payload: %v", err)
			}
			return jsonResponse(req, `{"data":{"publish_id":"photo-upload-1"},"error":{"code":"ok"}}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}`), nil
		case tiktokCreatorInfoURL:
			t.Fatal("photo upload must not query creator info or require direct-post privacy")
			return nil, nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback")
	externalID, err := adapter.Publish(context.Background(), "access", "open-1", &PublishRequest{
		Profile:          "carousel",
		Content:          "Photo description",
		PlatformMediaIDs: []string{"https://media.example/one.webp", "https://media.example/two.jpeg"},
		Media: []MediaItem{
			{ID: "photo-1", MimeType: "image/webp"},
			{ID: "photo-2", MimeType: "image/jpeg"},
		},
		Settings: map[string]interface{}{
			"content_posting_method": "UPLOAD",
			"photo_title":            "Photo title",
			"comment":                true,
			"auto_add_music":         true,
		},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if externalID.ExternalID != "photo-upload-1" {
		t.Fatalf("expected publish id, got %q", externalID)
	}
	if initPayload["post_mode"] != "MEDIA_UPLOAD" || initPayload["media_type"] != "PHOTO" {
		t.Fatalf("unexpected photo upload mode: %#v", initPayload)
	}
	postInfo, ok := initPayload["post_info"].(map[string]any)
	if !ok {
		t.Fatalf("missing post_info: %#v", initPayload)
	}
	if postInfo["title"] != "Photo title" || postInfo["description"] != "Photo description" {
		t.Fatalf("unexpected upload metadata: %#v", postInfo)
	}
	for _, key := range []string{"privacy_level", "disable_comment", "auto_add_music", "brand_content_toggle", "brand_organic_toggle"} {
		if _, exists := postInfo[key]; exists {
			t.Fatalf("upload post_info must not include direct-post field %q: %#v", key, postInfo)
		}
	}
	sourceInfo, ok := initPayload["source_info"].(map[string]any)
	if !ok {
		t.Fatalf("missing source_info: %#v", initPayload)
	}
	images, ok := sourceInfo["photo_images"].([]any)
	if !ok || len(images) != 2 {
		t.Fatalf("expected official photo_images array, got %#v", sourceInfo)
	}
	if _, exists := sourceInfo["photo_urls"]; exists {
		t.Fatalf("unexpected non-contract photo_urls field: %#v", sourceInfo)
	}
}

func TestTikTokPublishRejectsUnsupportedPhotoMedia(t *testing.T) {
	adapter := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback")

	t.Run("PNG", func(t *testing.T) {
		_, err := adapter.Publish(context.Background(), "access", "open-1", &PublishRequest{
			Profile:          "carousel",
			PlatformMediaIDs: []string{"https://media.example/photo.png"},
			Media:            []MediaItem{{ID: "photo-1", MimeType: "image/png"}},
		})
		if err == nil || !strings.Contains(err.Error(), "JPEG or WebP") {
			t.Fatalf("expected TikTok photo MIME error, got %v", err)
		}
	})

	t.Run("more than 35 photos", func(t *testing.T) {
		mediaURLs := make([]string, 36)
		media := make([]MediaItem, 36)
		for index := range media {
			mediaURLs[index] = "https://media.example/photo.webp"
			media[index] = MediaItem{ID: "photo", MimeType: "image/webp"}
		}
		_, err := adapter.Publish(context.Background(), "access", "open-1", &PublishRequest{
			Profile:          "carousel",
			PlatformMediaIDs: mediaURLs,
			Media:            media,
		})
		if err == nil || !strings.Contains(err.Error(), "1-35 images") {
			t.Fatalf("expected TikTok photo count error, got %v", err)
		}
	})
}

func jsonResponse(req *http.Request, body string) *http.Response {
	return jsonResponseWithStatus(req, http.StatusOK, body)
}

func jsonResponseWithStatus(req *http.Request, statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Header:     http.Header{"Content-Type": []string{contentTypeJSON}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}
