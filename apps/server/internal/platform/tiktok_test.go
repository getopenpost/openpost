package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
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

func TestTikTokScopeCapabilitiesSplitRequiredFromOptional(t *testing.T) {
	required := TikTokRequiredPublishingScopes()
	if len(required) != 3 || required[0] != "user.info.basic" || required[1] != "video.publish" || required[2] != "video.upload" {
		t.Fatalf("unexpected minimal publishing scopes: %q", required)
	}

	optional := TikTokOptionalDisplayScopes()
	if len(optional) != 3 || optional[0] != "user.info.profile" || optional[1] != "user.info.stats" || optional[2] != "video.list" {
		t.Fatalf("unexpected optional display scopes: %q", optional)
	}

	def := TikTokDefaultScopeCapabilities().Scopes()
	want := []string{"user.info.basic", "user.info.profile", "user.info.stats", "video.list", "video.publish", "video.upload"}
	if strings.Join(def, ",") != strings.Join(want, ",") {
		t.Fatalf("default scope set changed: got %q want %q", def, want)
	}

	minimal := TikTokDefaultScopeCapabilities().WithoutDisplayAPI().Scopes()
	if strings.Join(minimal, ",") != strings.Join(required, ",") {
		t.Fatalf("display-disabled scope set is not the minimal publishing set: got %q", minimal)
	}

	for _, set := range [][]string{def, required, optional} {
		seen := map[string]struct{}{}
		for _, scope := range set {
			if _, duplicate := seen[scope]; duplicate {
				t.Fatalf("duplicate scope %q in %q", scope, set)
			}
			seen[scope] = struct{}{}
		}
	}
}

func TestTikTokGenerateAuthURLUsesInstallationCapabilitySet(t *testing.T) {
	minimal := NewTikTokAdapterWithCapabilities("client-key", "client-secret", "https://app.example/callback", TikTokMinimalScopeCapabilities())

	authURL, _ := minimal.GenerateAuthURL("state-123")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}
	scope := parsed.Query().Get("scope")
	if scope != "user.info.basic,video.publish,video.upload" {
		t.Fatalf("expected minimal publishing scopes, got %q", scope)
	}
	for _, dropped := range TikTokOptionalDisplayScopes() {
		if strings.Contains(scope, dropped) {
			t.Fatalf("minimal auth url must not request display scope %q: %q", dropped, scope)
		}
	}

	capabilityURL, _ := minimal.GenerateAuthURLWithCapabilities("state-123", TikTokDefaultScopeCapabilities())
	capabilityScope := mustParseQuery(t, capabilityURL).Get("scope")
	for _, want := range []string{"video.publish", "user.info.stats", "video.list"} {
		if !strings.Contains(capabilityScope, want) {
			t.Fatalf("expected capability auth url to contain %q, got %q", want, capabilityScope)
		}
	}

	if got := minimal.RequestedScopes(); strings.Join(got, ",") != scope {
		t.Fatalf("RequestedScopes %q does not match auth url scope %q", got, scope)
	}
}

func TestTikTokAdapterAlwaysRequestsBothPublishingScopes(t *testing.T) {
	for _, capabilities := range []TikTokScopeCapabilities{
		{Profile: true},
		{DirectPost: true},
	} {
		adapter := NewTikTokAdapterWithCapabilities("key", "secret", "https://app.example/callback", capabilities)
		require.Contains(t, adapter.RequestedScopes(), "video.publish")
		require.Contains(t, adapter.RequestedScopes(), "video.upload")
	}
}

func mustParseQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}
	return parsed.Query()
}

func TestTikTokGetProfileFallsBackToBasicFieldsWithoutDisplayGrant(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokUserInfoURL:
			return jsonResponse(req, `{"data":{},"error":{"code":"scope_not_authorized","message":"scope not authorized","log_id":"log"}}`), nil
		case tiktokUserInfoBasicURL:
			return jsonResponse(req, `{"data":{"user":{"open_id":"open-1","display_name":"Creator","avatar_url":"https://cdn.tiktok.example/avatar.jpg"}},"error":{"code":"ok","message":"","log_id":"log"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	profile, err := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback").GetProfile(context.Background(), "access")
	if err != nil {
		t.Fatalf("GetProfile with basic grant returned error: %v", err)
	}
	if profile.ID != "open-1" || profile.DisplayName != "Creator" {
		t.Fatalf("unexpected degraded profile: %#v", profile)
	}
	if profile.CapabilityState["tiktok_display_profile"] != "unavailable" {
		t.Fatalf("expected degraded display capability state, got %#v", profile.CapabilityState)
	}
}

func TestTikTokGetProfileStillFailsForDeadToken(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return jsonResponse(req, `{"data":{},"error":{"code":"access_token_invalid","message":"invalid token","log_id":"log"}}`), nil
	})}

	if _, err := NewTikTokAdapter("client-key", "client-secret", "https://app.example/callback").GetProfile(context.Background(), "access"); err == nil {
		t.Fatalf("expected dead-token profile error")
	}
	if calls != 1 {
		t.Fatalf("dead token must not trigger a basic-fields retry, got %d calls", calls)
	}
}

func TestTikTokPublishAcceptsCompletedVideoWithoutVideoListGrant(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokCreatorInfoURL:
			return jsonResponse(req, `{"data":{"privacy_level_options":["PUBLIC_TO_EVERYONE"]},"error":{"code":"ok"}}`), nil
		case tiktokVideoInitURL:
			return jsonResponse(req, `{"data":{"publish_id":"publish-1"},"error":{"code":"ok"}}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"PUBLISH_COMPLETE"},"error":{"code":"ok"}}`), nil
		case tiktokVideoListURL:
			return jsonResponse(req, `{"data":{},"error":{"code":"scope_permission_missed","message":"permission missed","log_id":"log"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	request := &PublishRequest{
		Content: "Launch video", PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:    []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
		Settings: map[string]interface{}{"content_posting_method": "DIRECT_POST", "privacy_level": "PUBLIC_TO_EVERYONE"},
	}
	request.SetWriteFence(func(PublishResult) error { return nil }, func(PublishResult) error { return nil })
	result, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").Publish(t.Context(), "access", "open-1", request)
	if err != nil {
		t.Fatalf("completed publish without video.list grant returned error: %v", err)
	}
	if result.ExternalID != "publish-1" {
		t.Fatalf("expected provider publish id fallback, got %#v", result)
	}
}

func TestTikTokAnalyticsSupportExplainsDisplayDisabledInstallation(t *testing.T) {
	full := NewTikTokAdapter("key", "secret", "https://app.example/callback")
	support := full.AnalyticsSupport()
	if !support.Account || !support.Content {
		t.Fatalf("default adapter must support analytics, got %#v", support)
	}

	minimal := NewTikTokAdapterWithCapabilities("key", "secret", "https://app.example/callback", TikTokMinimalScopeCapabilities())
	degraded := minimal.AnalyticsSupport()
	if degraded.Account || degraded.Content {
		t.Fatalf("display-disabled adapter must not advertise analytics, got %#v", degraded)
	}
	if !strings.Contains(degraded.AccountUnavailable, "user.info.stats") || !strings.Contains(degraded.ContentUnavailable, "video.list") {
		t.Fatalf("analytics unavailability must name the missing scopes, got %#v", degraded)
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

func TestTikTokPublishReconcilesCompletedVideoWithoutPublicID(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	createdAt := time.Now().UTC().Add(-time.Minute).Unix()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokCreatorInfoURL:
			return jsonResponse(req, `{"data":{"privacy_level_options":["PUBLIC_TO_EVERYONE"]},"error":{"code":"ok"}}`), nil
		case tiktokVideoInitURL:
			return jsonResponse(req, `{"data":{"publish_id":"publish-1"},"error":{"code":"ok"}}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"PUBLISH_COMPLETE"},"error":{"code":"ok"}}`), nil
		case tiktokVideoListURL:
			return jsonResponse(req, fmt.Sprintf(`{"data":{"videos":[{"id":"7511111111111111111","create_time":%d,"video_description":"Launch   video"}]},"error":{"code":"ok"}}`, createdAt)), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}
	request := &PublishRequest{
		Content: "Launch video", PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:    []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
		Settings: map[string]interface{}{"content_posting_method": "DIRECT_POST", "privacy_level": "PUBLIC_TO_EVERYONE"},
	}
	request.SetWriteFence(func(PublishResult) error { return nil }, func(PublishResult) error { return nil })
	result, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").Publish(t.Context(), "access", "open-1", request)
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if result.ExternalID != "7511111111111111111" {
		t.Fatalf("expected reconciled video id, got %#v", result)
	}
}

func TestTikTokPublishKeepsAmbiguousCompletedVideoPending(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	createdAt := time.Now().UTC().Add(-time.Minute).Unix()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokCreatorInfoURL:
			return jsonResponse(req, `{"data":{"privacy_level_options":["PUBLIC_TO_EVERYONE"]},"error":{"code":"ok"}}`), nil
		case tiktokVideoInitURL:
			return jsonResponse(req, `{"data":{"publish_id":"publish-1"},"error":{"code":"ok"}}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"PUBLISH_COMPLETE"},"error":{"code":"ok"}}`), nil
		case tiktokVideoListURL:
			return jsonResponse(req, fmt.Sprintf(`{"data":{"videos":[{"id":"7511111111111111111","create_time":%d,"video_description":"Launch video"},{"id":"7522222222222222222","create_time":%d,"video_description":"Launch video"}]},"error":{"code":"ok"}}`, createdAt, createdAt)), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}
	request := &PublishRequest{
		Content: "Launch video", PlatformMediaIDs: []string{"https://media.example/video.mp4"},
		Media:    []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
		Settings: map[string]interface{}{"content_posting_method": "DIRECT_POST", "privacy_level": "PUBLIC_TO_EVERYONE"},
	}
	var checkpoints []PublishResult
	request.SetWriteFence(func(PublishResult) error { return nil }, func(result PublishResult) error {
		checkpoints = append(checkpoints, result)
		return nil
	})
	_, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").Publish(t.Context(), "access", "open-1", request)
	if err == nil || !strings.Contains(err.Error(), "expected one recent exact match, found 2") {
		t.Fatalf("expected ambiguous reconciliation error, got %v", err)
	}
	if len(checkpoints) != 2 || checkpoints[1].ProviderState != "published_unresolved" || checkpoints[1].RetrySafety != PublishRetryReconcileOnly {
		t.Fatalf("expected durable unresolved checkpoint, got %#v", checkpoints)
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

func TestValidateTikTokPublicMediaURLsRejectsUnsafeTargets(t *testing.T) {
	if err := validateTikTokPublicMediaURLs([]string{"https://media.example/video.mp4"}); err != nil {
		t.Fatalf("valid media URL rejected: %v", err)
	}
	if err := validateTikTokPublicMediaURLs([]string{"https://media.example:8443/video.mp4"}); err != nil {
		t.Fatalf("custom-port media URL rejected: %v", err)
	}
	for _, raw := range []string{
		"http://media.example/video.mp4",
		"https://user:secret@media.example/video.mp4",
		"https://media.example/video.mp4#fragment",
		"not-a-url",
		"",
	} {
		if err := validateTikTokPublicMediaURLs([]string{raw}); err == nil {
			t.Fatalf("expected media URL %q to be rejected", raw)
		}
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

// TikTok's Media Transfer Guide: total_chunk_count is video_size divided by
// chunk_size rounded down, every chunk is 5-64 MB except the final one, which
// carries the trailing bytes (up to 128 MB), and a video over 64 MB must be
// sent in more than one chunk.
func TestTikTokFileUploadSendsTheChunksItDeclares(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const uploadURL = "https://open-upload.tiktokapis.com/video/?upload_id=1"
	const videoSize = tiktokMaxChunkSize + 3
	var chunkSize, totalChunks int64
	var puts []int64
	var next int64
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.String() {
		case tiktokVideoInboxInitURL:
			var body struct {
				SourceInfo struct {
					VideoSize       int64 `json:"video_size"`
					ChunkSize       int64 `json:"chunk_size"`
					TotalChunkCount int64 `json:"total_chunk_count"`
				} `json:"source_info"`
			}
			require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
			require.Equal(t, int64(videoSize), body.SourceInfo.VideoSize)
			chunkSize, totalChunks = body.SourceInfo.ChunkSize, body.SourceInfo.TotalChunkCount
			return jsonResponse(req, `{"data":{"publish_id":"publish-1","upload_url":"`+uploadURL+`"},"error":{"code":"ok"}}`), nil
		case uploadURL:
			size, err := io.Copy(io.Discard, req.Body)
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf("bytes %d-%d/%d", next, next+size-1, videoSize), req.Header.Get("Content-Range"))
			next += size
			puts = append(puts, size)
			return jsonResponseWithStatus(req, http.StatusCreated, `{}`), nil
		case tiktokPublishStatusURL:
			return jsonResponse(req, `{"data":{"status":"SEND_TO_USER_INBOX"},"error":{"code":"ok"}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	publishID, err := NewTikTokAdapter("key", "secret", "https://app.example/callback").UploadMediaWithMetadata(t.Context(), "access", "open-1", UploadMediaRequest{
		MimeType: "video/mp4",
		Settings: map[string]interface{}{"content_posting_method": "MEDIA_UPLOAD"},
		Reader:   bytes.NewReader(make([]byte, videoSize)),
	})
	require.NoError(t, err)
	require.Equal(t, "publish-1", publishID)
	require.Equal(t, int64(videoSize), next)
	require.Equal(t, videoSize/chunkSize, totalChunks, "total_chunk_count must be video_size / chunk_size rounded down")
	require.Len(t, puts, int(totalChunks))
	require.GreaterOrEqual(t, totalChunks, int64(2), "a video over 64 MB must be sent in several chunks")
	for index, size := range puts[:len(puts)-1] {
		require.Equal(t, chunkSize, size, "chunk %d", index)
	}
	require.GreaterOrEqual(t, chunkSize, int64(5*1024*1024))
	require.LessOrEqual(t, chunkSize, int64(tiktokMaxChunkSize))
	final := puts[len(puts)-1]
	require.GreaterOrEqual(t, final, chunkSize, "the final chunk carries the trailing bytes")
	require.LessOrEqual(t, final, int64(128*1024*1024))
}

func TestTikTokUploadChunksFollowTheTransferGuide(t *testing.T) {
	const mib = 1024 * 1024
	for _, videoSize := range []int64{1, 4 * mib, 64 * mib, 64*mib + 1, 100 * mib, 128 * mib, 130 * mib, 4 * 1024 * mib} {
		chunkSize, totalChunks := tiktokUploadChunks(videoSize)
		if videoSize <= tiktokMaxChunkSize {
			require.Equal(t, videoSize, chunkSize, "size %d goes as a whole", videoSize)
			require.Equal(t, int64(1), totalChunks, "size %d goes as a whole", videoSize)
			continue
		}
		require.Equal(t, videoSize/chunkSize, totalChunks, "size %d", videoSize)
		require.GreaterOrEqual(t, totalChunks, int64(2), "size %d", videoSize)
		require.LessOrEqual(t, totalChunks, int64(1000), "size %d", videoSize)
		require.GreaterOrEqual(t, chunkSize, int64(5*mib), "size %d", videoSize)
		require.LessOrEqual(t, chunkSize, int64(tiktokMaxChunkSize), "size %d", videoSize)
		final := videoSize - (totalChunks-1)*chunkSize
		require.GreaterOrEqual(t, final, chunkSize, "size %d", videoSize)
		require.LessOrEqual(t, final, int64(128*mib), "size %d", videoSize)
	}
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
