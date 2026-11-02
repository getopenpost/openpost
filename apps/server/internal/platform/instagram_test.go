package platform

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/openpost/backend/internal/providerlimits"
)

func TestInstagramContainerSettingsStayWithinProviderRules(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	adapter := NewInstagramAdapter("", "", "")

	t.Run("story omits stale collaborators", func(t *testing.T) {
		originalClient := httpClient
		defer func() { httpClient = originalClient }()
		httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if err := req.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if req.Form.Get("media_type") != "STORIES" || req.Form.Get("collaborators") != "" {
				t.Fatalf("unexpected Story container payload: %s", req.Form.Encode())
			}
			if altText := req.Form.Get("alt_text"); altText != "" {
				t.Fatalf("Stories do not support alt_text, got %q", altText)
			}
			return jsonResponse(req, `{"id":"container-1"}`), nil
		})}
		id, err := adapter.createMediaContainer(t.Context(), "token", "ig-1", "Story", "https://media.example/story.jpg", false, false, &PublishRequest{
			OutputProfile: "instagram.story", Settings: map[string]interface{}{"collaborators": "one,two"},
		}, nil, "story alt text")
		if err != nil {
			t.Fatal(err)
		}
		if id != "container-1" {
			t.Fatalf("unexpected native container ID %q", id)
		}
	})

	for _, test := range []struct {
		name     string
		profile  string
		settings map[string]interface{}
		message  string
	}{
		{name: "trial requires Reel", profile: "instagram.feed", settings: map[string]interface{}{"is_trial_reel": true, "graduation_strategy": "MANUAL"}, message: "require the Reel format"},
		{name: "trial rejects collaborators", profile: "instagram.reel", settings: map[string]interface{}{"is_trial_reel": true, "graduation_strategy": "MANUAL", "collaborators": "one"}, message: "cannot include collaborators"},
		{name: "collaborators are capped", profile: "instagram.reel", settings: map[string]interface{}{"collaborators": "one,two,three,four"}, message: "at most 3 collaborators"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := adapter.createMediaContainer(t.Context(), "token", "ig-1", "Caption", "https://media.example/reel.mp4", true, false, &PublishRequest{
				OutputProfile: test.profile, Settings: test.settings,
			}, nil, "")
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("expected %q rejection, got %v", test.message, err)
			}
		})
	}

	t.Run("alt text over the provider limit is rejected", func(t *testing.T) {
		if providerlimits.InstagramAltTextMaxCharacters != 1000 {
			t.Fatalf("Instagram alt text limit changed: %d", providerlimits.InstagramAltTextMaxCharacters)
		}
		_, err := adapter.createMediaContainer(t.Context(), "token", "ig-1", "Caption", "https://media.example/image.jpg", false, false, &PublishRequest{
			OutputProfile: "instagram.feed",
		}, nil, strings.Repeat("a", providerlimits.InstagramAltTextMaxCharacters+1))
		if err == nil || !strings.Contains(err.Error(), "limited to 1000 characters") {
			t.Fatalf("expected over-limit alt text rejection, got %v", err)
		}
	})

	t.Run("alt text at the provider limit reaches the container", func(t *testing.T) {
		originalClient := httpClient
		defer func() { httpClient = originalClient }()
		httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if err := req.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if got := req.Form.Get("alt_text"); got != strings.Repeat("a", providerlimits.InstagramAltTextMaxCharacters) {
				t.Fatalf("expected alt_text at the provider limit, got %d characters", len(got))
			}
			return jsonResponse(req, `{"id":"container-1"}`), nil
		})}
		id, err := adapter.createMediaContainer(t.Context(), "token", "ig-1", "Caption", "https://media.example/image.jpg", false, false, &PublishRequest{
			OutputProfile: "instagram.feed",
		}, nil, strings.Repeat("a", providerlimits.InstagramAltTextMaxCharacters))
		if err != nil {
			t.Fatal(err)
		}
		if id != "container-1" {
			t.Fatalf("unexpected native container ID %q", id)
		}
	})

	t.Run("video alt text is never projected to Instagram", func(t *testing.T) {
		originalClient := httpClient
		defer func() { httpClient = originalClient }()
		httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if err := req.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if req.Form.Get("alt_text") != "" {
				t.Fatalf("unexpected alt_text on a video container: %s", req.Form.Encode())
			}
			return jsonResponse(req, `{"id":"container-1"}`), nil
		})}
		_, err := adapter.createMediaContainer(t.Context(), "token", "ig-1", "Caption", "https://media.example/reel.mp4", true, false, &PublishRequest{
			OutputProfile: "instagram.reel",
		}, nil, strings.Repeat("a", providerlimits.InstagramAltTextMaxCharacters+1))
		if err != nil {
			t.Fatalf("alt text on a video container is dropped, not rejected: %v", err)
		}
	})
}

func TestInstagramRetriesExactMediaContainerPropagationFailure(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		t.Setenv("META_GRAPH_API_VERSION", "v25.0")
		originalClient := httpClient
		defer func() { httpClient = originalClient }()
		attempts := 0
		var firstPayload string
		httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			attempts++
			if err := req.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if attempts == 1 {
				firstPayload = req.Form.Encode()
			} else if req.Form.Encode() != firstPayload {
				t.Fatal("container retry changed the payload")
			}
			if attempts < 3 {
				return &http.Response{StatusCode: http.StatusBadRequest, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":{"code":9004,"error_subcode":2207052}}`)), Request: req}, nil
			}
			return jsonResponse(req, `{"id":"container-1"}`), nil
		})}
		started := time.Now()
		id, err := NewInstagramAdapter("", "", "").createMediaContainer(t.Context(), "token", "ig-1", "Caption", "https://media.example/image.jpg", false, false, &PublishRequest{}, nil, "")
		if err != nil || id != "container-1" || attempts != 3 {
			t.Fatalf("id=%q attempts=%d err=%v", id, attempts, err)
		}
		if time.Since(started) < 4*time.Second {
			t.Fatal("container propagation retries must back off")
		}
	})
}

func TestInstagramReportsNoPageLinkedProfessionalAccount(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v25.0/me/accounts" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		return jsonResponse(req, `{"data":[{"id":"page-1","name":"OpenPost Page","access_token":"page-token"}]}`), nil
	})}

	adapter := NewInstagramAdapter("client-id", "client-secret", "https://app.example/callback")
	_, err := adapter.ListAccountSelections(context.Background(), &TokenResult{AccessToken: "user-token"})
	if !errors.Is(err, ErrNoInstagramProfessionalAccount) {
		t.Fatalf("expected ErrNoInstagramProfessionalAccount, got %v", err)
	}
}

func TestInstagramGenerateAuthURL(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	adapter := NewInstagramAdapter("client-id", "client-secret", "https://app.example/api/v1/accounts/instagram/callback")

	authURL, _ := adapter.GenerateAuthURL("state-123")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}
	if parsed.Scheme != "https" || parsed.Host != "www.facebook.com" || parsed.Path != "/v25.0/dialog/oauth" {
		t.Fatalf("unexpected auth url %s", authURL)
	}
	query := parsed.Query()
	if query.Get("auth_type") != "rerequest" {
		t.Fatalf("reconnect must request declined permissions again: %s", authURL)
	}
	if query.Get(oauthParamClientID) != "client-id" {
		t.Fatalf("expected client id, got %q", query.Get(oauthParamClientID))
	}
	if !strings.Contains(query.Get("scope"), "instagram_content_publish") {
		t.Fatalf("expected instagram_content_publish scope, got %q", query.Get("scope"))
	}
	for _, scope := range []string{"instagram_manage_comments", "instagram_manage_messages", "pages_read_user_content", "pages_manage_metadata"} {
		if !strings.Contains(query.Get("scope"), scope) {
			t.Fatalf("expected %s scope, got %q", scope, query.Get("scope"))
		}
	}
	if !strings.Contains(query.Get("scope"), "business_management") {
		t.Fatalf("expected business_management scope for Business Portfolio Pages, got %q", query.Get("scope"))
	}
}

func TestInstagramGenerateAuthURLWithLoginConfiguration(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	adapter := NewInstagramAdapter("client-id", "client-secret", "https://app.example/api/v1/accounts/instagram/callback")
	adapter.configID = "config-123"

	authURL, _ := adapter.GenerateAuthURL("state-123")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}
	if parsed.Scheme != "https" || parsed.Host != "www.facebook.com" || parsed.Path != "/v25.0/dialog/oauth" {
		t.Fatalf("unexpected auth url %s", authURL)
	}
	query := parsed.Query()
	if query.Get("config_id") != "config-123" {
		t.Fatalf("expected the Facebook Login for Business configuration id, got %q", query.Get("config_id"))
	}
	if query.Get("scope") != "" {
		t.Fatalf("config_id replaces the scope list in the login dialog: %s", authURL)
	}
	if query.Get("auth_type") != "" {
		t.Fatalf("the configuration dialog must not re-request permissions: %s", authURL)
	}
	if query.Get("response_type") != "code" || query.Get("state") != "state-123" ||
		query.Get(oauthParamClientID) != "client-id" ||
		query.Get(oauthParamRedirectURI) != "https://app.example/api/v1/accounts/instagram/callback" {
		t.Fatalf("unexpected dialog parameters: %s", authURL)
	}
}

func TestInstagramExchangeAndSelectBusinessAccount(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	accountsCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/oauth/access_token":
			if req.Method != http.MethodPost || req.URL.RawQuery != "" {
				t.Fatal("token exchange must keep credentials in its POST body")
			}
			if err := req.ParseForm(); err != nil {
				t.Fatal(err)
			}
			query := req.PostForm
			if query.Get(grantType) == "fb_exchange_token" {
				return jsonResponse(req, `{"access_token":"long-token","token_type":"bearer","expires_in":5184000}`), nil
			}
			return jsonResponse(req, `{"access_token":"short-token","token_type":"bearer","expires_in":3600}`), nil
		case "/v25.0/me/accounts":
			accountsCalls++
			if req.Header.Get(headerAuthorization) != "Bearer long-token" {
				t.Fatalf("unexpected accounts token %q", req.URL.Query().Get(oauthParamAccessToken))
			}
			return jsonResponse(req, `{"data":[{"id":"page-1","name":"OpenPost Page","access_token":"page-token","picture":{"data":{"url":"https://cdn.example/page.png"}},"instagram_business_account":{"id":"ig-1","username":"openpost","name":"OpenPost IG","profile_picture_url":"https://cdn.example/ig.png","account_type":"CREATOR"}}]}`), nil
		case "/v25.0/me/permissions":
			return jsonResponse(req, `{"data":[{"permission":"instagram_basic","status":"granted"},{"permission":"instagram_content_publish","status":"granted"},{"permission":"instagram_manage_insights","status":"granted"},{"permission":"pages_show_list","status":"granted"},{"permission":"pages_read_engagement","status":"granted"}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewInstagramAdapter("client-id", "client-secret", "https://app.example/callback")
	token, err := adapter.ExchangeCode(context.Background(), "auth-code", nil)
	if err != nil {
		t.Fatalf("ExchangeCode returned error: %v", err)
	}
	if token.AccessToken != "long-token" {
		t.Fatalf("unexpected token: %#v", token)
	}
	if !strings.Contains(token.Extra["scope"], "instagram_manage_insights") {
		t.Fatalf("expected granted Instagram analytics scope, got %#v", token.Extra)
	}

	options, err := adapter.ListAccountSelections(context.Background(), token)
	if err != nil {
		t.Fatalf("ListAccountSelections returned error: %v", err)
	}
	if len(options) != 1 || options[0].ID != "ig-1" || options[0].Username != "openpost" {
		t.Fatalf("unexpected options: %#v", options)
	}

	selected, err := adapter.SelectAccount(context.Background(), token, "ig-1")
	if err != nil {
		t.Fatalf("SelectAccount returned error: %v", err)
	}
	if selected.AccountID != "ig-1" || selected.Token.AccessToken != "page-token" || selected.Token.ExpiresIn != 0 {
		t.Fatalf("unexpected selected account: %#v", selected)
	}
	if !strings.Contains(selected.Token.Extra["scope"], "instagram_manage_insights") {
		t.Fatalf("expected selected account to preserve scopes, got %#v", selected.Token.Extra)
	}
	if selected.CapabilityState["instagram_account_type"] != "creator" || selected.CapabilityState["facebook_page_id"] != "page-1" {
		t.Fatalf("expected Creator account capability state, got %#v", selected.CapabilityState)
	}
	if accountsCalls != 2 {
		t.Fatalf("expected two accounts calls, got %d", accountsCalls)
	}
}

func TestInstagramResumeRecoversPublishedIDFromMatchingRecentMedia(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	mediaListings := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
		case "/v25.0/ig-1/media":
			mediaListings++
			if got := req.URL.Query().Get("fields"); got != "id,caption,media_type" {
				t.Fatalf("unexpected recent-media fields: %q", got)
			}
			if got := req.URL.Query().Get("limit"); got != "10" {
				t.Fatalf("recent-media lookup must stay bounded, got limit %q", got)
			}
			if got := req.URL.Query().Get(oauthParamAccessToken); got != "" {
				t.Fatalf("the transport owns the token, got query token %q", got)
			}
			if got := req.Header.Get(headerAuthorization); got != "Bearer page-token" {
				t.Fatalf("unexpected recent-media authorization: %q", got)
			}
			return jsonResponse(req, `{"data":[
				{"id":"ig-other","caption":"Different caption","media_type":"IMAGE"},
				{"id":"ig-video","caption":"Launch image","media_type":"VIDEO"},
				{"id":"ig-media-1","caption":"Launch image","media_type":"IMAGE"}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	result, err := NewInstagramAdapter("", "", "").ResumePublish(
		t.Context(),
		"page-token",
		"ig-1",
		&PublishRequest{
			Content:          "Launch image",
			PlatformMediaIDs: []string{"https://media.example/image.jpg"},
			Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
		},
		"ig1:f:container-1",
	)
	if err != nil {
		t.Fatalf("ResumePublish returned error: %v", err)
	}
	if result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != "ig-media-1" {
		t.Fatalf("expected the unique caption and media_type match to be adopted: %#v", result)
	}
	if result.ProviderState != instagramPublishedProviderState {
		t.Fatalf("unexpected provider state: %#v", result)
	}
	if mediaListings != 1 {
		t.Fatalf("expected one recent-media listing, got %d", mediaListings)
	}
}

func TestInstagramResumeRecoversPublishedIDForVideoAndCarousel(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	tests := []struct {
		name    string
		media   string
		wantID  string
		want    string
		request *PublishRequest
	}{
		{
			name:   "video",
			want:   "VIDEO",
			wantID: "ig-video-1",
			request: &PublishRequest{
				Content:          "Launch video",
				PlatformMediaIDs: []string{"https://media.example/video.mp4"},
				Media:            []MediaItem{{ID: "media-1", MimeType: "video/mp4"}},
			},
		},
		{
			name:   "carousel",
			want:   "CAROUSEL_ALBUM",
			wantID: "ig-carousel-1",
			request: &PublishRequest{
				Content:          "Launch carousel",
				PlatformMediaIDs: []string{"https://media.example/one.jpg", "https://media.example/two.jpg"},
				Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}, {ID: "media-2", MimeType: "image/jpeg"}},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalClient := httpClient
			defer func() { httpClient = originalClient }()

			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				switch req.URL.Path {
				case "/v25.0/container-1":
					return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
				case "/v25.0/ig-1/media":
					items := fmt.Sprintf(`{"id":"ig-image","caption":"%s","media_type":"IMAGE"},{"id":"%s","caption":"%s","media_type":"%s"}`,
						test.request.Content, test.wantID, test.request.Content, test.want)
					return jsonResponse(req, `{"data":[`+items+`]}`), nil
				default:
					t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
					return nil, nil
				}
			})}

			result, err := NewInstagramAdapter("", "", "").ResumePublish(
				t.Context(), "page-token", "ig-1", test.request, "ig1:p:container-1",
			)
			if err != nil {
				t.Fatalf("ResumePublish returned error: %v", err)
			}
			if result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != test.wantID {
				t.Fatalf("expected the %s match to be adopted: %#v", test.want, result)
			}
		})
	}
}

func TestInstagramResumePublishedIDRecoveryRequiresStrictUniqueMatch(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	tests := []struct {
		name  string
		media string
	}{
		{name: "no matching caption", media: `{"data":[{"id":"ig-other","caption":"Different caption","media_type":"IMAGE"}]}`},
		{name: "multiple matches stay ambiguous", media: `{"data":[{"id":"ig-media-1","caption":"Launch image","media_type":"IMAGE"},{"id":"ig-media-2","caption":"Launch image","media_type":"IMAGE"}]}`},
		{name: "wrong media type with same caption", media: `{"data":[{"id":"ig-video","caption":"Launch image","media_type":"VIDEO"}]}`},
		{name: "caption differing by one character", media: `{"data":[{"id":"ig-media-1","caption":"Launch images","media_type":"IMAGE"}]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalClient := httpClient
			defer func() { httpClient = originalClient }()

			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				switch req.URL.Path {
				case "/v25.0/container-1":
					return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
				case "/v25.0/ig-1/media":
					return jsonResponse(req, test.media), nil
				default:
					t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
					return nil, nil
				}
			})}

			result, err := NewInstagramAdapter("", "", "").ResumePublish(
				t.Context(),
				"page-token",
				"ig-1",
				&PublishRequest{
					Content:          "Launch image",
					PlatformMediaIDs: []string{"https://media.example/image.jpg"},
					Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
				},
				"ig1:container-1",
			)
			if err != nil {
				t.Fatalf("ResumePublish returned error: %v", err)
			}
			if result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != "" {
				t.Fatalf("ambiguous matches must keep the empty ID: %#v", result)
			}
		})
	}
}

func TestInstagramResumePublishedIDRecoveryNeedsAuthoredCaption(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	tests := []struct {
		name string
		req  *PublishRequest
	}{
		{name: "empty caption never lists recent media", req: &PublishRequest{
			Content:          "   ",
			PlatformMediaIDs: []string{"https://media.example/image.jpg"},
			Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
		}},
		{name: "missing request never lists recent media", req: nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalClient := httpClient
			defer func() { httpClient = originalClient }()

			paths := []string{}
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				paths = append(paths, req.URL.Path)
				if req.URL.Path != "/v25.0/container-1" {
					t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
				}
				return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
			})}

			result, err := NewInstagramAdapter("", "", "").ResumePublish(
				t.Context(), "page-token", "ig-1", test.req, "ig1:container-1",
			)
			if err != nil {
				t.Fatalf("ResumePublish returned error: %v", err)
			}
			if result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != "" {
				t.Fatalf("captionless recovery must keep the empty ID: %#v", result)
			}
			if len(paths) != 1 {
				t.Fatalf("recovery must not call the recent-media edge without a caption: %v", paths)
			}
		})
	}
}

func TestInstagramPublishImageFromPublicURL(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var createForm url.Values
	var publishForm url.Values
	var events []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/ig-1/media":
			events = append(events, "create")
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading create body: %v", err)
			}
			createForm, err = url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing create form: %v", err)
			}
			return jsonResponse(req, `{"id":"container-1"}`), nil
		case "/v25.0/container-1":
			events = append(events, "status")
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/ig-1/media_publish":
			events = append(events, "publish")
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading publish body: %v", err)
			}
			publishForm, err = url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing publish form: %v", err)
			}
			return jsonResponse(req, `{"id":"ig-media-1"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewInstagramAdapter("client-id", "client-secret", "https://app.example/callback")
	req := &PublishRequest{
		Content:          "Launch image",
		PlatformMediaIDs: []string{"https://media.example/image.jpg"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
	}
	var checkpoints []PublishResult
	req.SetWriteFence(func(PublishResult) error { return nil }, func(result PublishResult) error {
		checkpoints = append(checkpoints, result)
		if result.SubmissionState == PublishSubmissionPending {
			events = append(events, "checkpoint")
		}
		return nil
	})
	externalID, err := adapter.Publish(context.Background(), "page-token", "ig-1", req)
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if externalID.ExternalID != "ig-media-1" {
		t.Fatalf("expected media id, got %q", externalID)
	}
	if createForm.Get("image_url") != "https://media.example/image.jpg" || createForm.Get("caption") != "Launch image" {
		t.Fatalf("unexpected create form: %s", createForm.Encode())
	}
	if publishForm.Get("creation_id") != "container-1" || publishForm.Get(oauthParamAccessToken) != "page-token" {
		t.Fatalf("unexpected publish form: %s", publishForm.Encode())
	}
	if len(checkpoints) != 3 ||
		checkpoints[0].SubmissionState != PublishSubmissionPending ||
		checkpoints[0].ProviderReference != "ig1:f:container-1" ||
		checkpoints[1].ProviderReference != "ig1:p:container-1" ||
		checkpoints[2].SubmissionState != PublishSubmissionAccepted {
		t.Fatalf("unexpected publish checkpoints: %#v", checkpoints)
	}
	if strings.Join(events, ",") != "create,checkpoint,status,checkpoint,publish" {
		t.Fatalf("container must be checkpointed before processing and publishing, got %v", events)
	}
}

func TestInstagramResumePublishFinishesCheckpointedContainer(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/ig-1/media_publish":
			return jsonResponse(req, `{"id":"ig-media-1"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	result, err := NewInstagramAdapter("", "", "").ResumePublish(
		t.Context(),
		"page-token",
		"ig-1",
		nil,
		"ig1:container-1",
	)
	if err != nil {
		t.Fatalf("ResumePublish returned error: %v", err)
	}
	if result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != "ig-media-1" {
		t.Fatalf("unexpected reconciliation result: %#v", result)
	}
}

func TestInstagramResumePublishDoesNotRepublishPublishedContainer(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v25.0/container-1" {
			t.Fatalf("published container must not be submitted again: %s %s", req.Method, req.URL.String())
		}
		return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
	})}

	result, err := NewInstagramAdapter("", "", "").ResumePublish(
		t.Context(),
		"page-token",
		"ig-1",
		nil,
		"ig1:container-1",
	)
	if err != nil {
		t.Fatalf("ResumePublish returned error: %v", err)
	}
	if result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != "" {
		t.Fatalf("unexpected published-container result: %#v", result)
	}
}

func TestInstagramResumePublishDoesNotReplayAmbiguousSubmission(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v25.0/container-1" {
			t.Fatalf("ambiguous submission must not be replayed: %s %s", req.Method, req.URL.String())
		}
		return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
	})}

	result, err := NewInstagramAdapter("", "", "").ResumePublish(
		t.Context(), "page-token", "ig-1", nil, "ig1:p:container-1",
	)
	if err != nil {
		t.Fatalf("ResumePublish returned error: %v", err)
	}
	if result.SubmissionState != PublishSubmissionPending || result.ProviderReference != "ig1:p:container-1" {
		t.Fatalf("unexpected ambiguous-submission result: %#v", result)
	}
}

func TestInstagramResumePublish10033StaysPendingWithoutAuthoritativeStatus(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	var requests []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.Method+" "+req.URL.Path)
		if req.URL.Path != "/v25.0/container-1" || req.Method != http.MethodGet {
			t.Fatalf("unconfirmed publish must not write: %s %s", req.Method, req.URL.String())
		}
		return jsonResponseWithStatus(req, http.StatusBadRequest, `{"error":{"message":"Object does not exist","code":100,"error_subcode":33}}`), nil
	})}
	result, err := NewInstagramLoginAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", &PublishRequest{}, "ig1:p:container-1")
	if err == nil {
		t.Fatal("expected the container status error to remain visible")
	}
	if result.SubmissionState != PublishSubmissionPending || result.ProviderReference != "ig1:p:container-1" || result.RetrySafety != PublishRetryReconcileOnly {
		t.Fatalf("missing authoritative status must remain pending, got %#v", result)
	}
	if strings.Join(requests, ",") != "GET /v25.0/container-1" {
		t.Fatalf("pending reconciliation must not republish: %v", requests)
	}
}

func TestInstagramResumePublishCompletesStorySequence(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/ig-1/media":
			return jsonResponse(req, `{"id":"container-2"}`), nil
		case "/v25.0/container-2":
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/ig-1/media_publish":
			return jsonResponse(req, `{"id":"published-2"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}
	req := &PublishRequest{
		Profile:          "story",
		PlatformMediaIDs: []string{"https://media.example/one.jpg", "https://media.example/two.jpg"},
		Media:            []MediaItem{{MimeType: "image/jpeg"}, {MimeType: "image/jpeg"}},
	}
	adapter := NewInstagramAdapter("", "", "")

	created, err := adapter.ResumePublish(t.Context(), "page-token", "ig-1", req, "ig1:s:1:published-1:-")
	if err != nil {
		t.Fatalf("creating resumed story container: %v", err)
	}
	if created.SubmissionState != PublishSubmissionPending || created.ProviderReference != "ig1:s:1:published-1:container-2" {
		t.Fatalf("unexpected story creation result: %#v", created)
	}

	completed, err := adapter.ResumePublish(t.Context(), "page-token", "ig-1", req, created.ProviderReference)
	if err != nil {
		t.Fatalf("publishing resumed story container: %v", err)
	}
	if completed.SubmissionState != PublishSubmissionAccepted || completed.ExternalID != "published-1,published-2" {
		t.Fatalf("unexpected story completion result: %#v", completed)
	}
}

func TestInstagramPublishRejectsNonHTTPSMediaURL(t *testing.T) {
	adapter := NewInstagramAdapter("client-id", "client-secret", "https://app.example/callback")
	_, err := adapter.Publish(context.Background(), "page-token", "ig-1", &PublishRequest{
		Content:          "Launch image",
		PlatformMediaIDs: []string{"http://media.example/image.jpg"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
	})
	if err == nil || !strings.Contains(err.Error(), "publicly-accessible HTTPS") {
		t.Fatalf("expected HTTPS URL error, got %v", err)
	}
}

func TestInstagramMissingStatusDoesNotPublish(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	defer func() { httpClient = original }()
	published := false
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/v25.0/ig/media":
			return jsonResponse(r, `{"id":"container"}`), nil
		case "/v25.0/container":
			return jsonResponse(r, `{}`), nil
		case "/v25.0/ig/media_publish":
			published = true
			return jsonResponse(r, `{"id":"post"}`), nil
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
			return nil, nil
		}
	})}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	_, err := NewInstagramAdapter("", "", "").Publish(ctx, "token", "ig", &PublishRequest{PlatformMediaIDs: []string{"https://media.example/image.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}}})
	if published || err == nil {
		t.Fatalf("unknown container status advanced to publication: published=%v err=%v", published, err)
	}
}

func TestInstagramReadinessRejectionResumesSameContainer(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	defer func() { httpClient = original }()
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodGet {
			return jsonResponse(r, `{"status_code":"FINISHED"}`), nil
		}
		calls++
		if calls <= 5 {
			resp := jsonResponse(r, `{"error":{"code":9007,"error_subcode":2207027}}`)
			resp.StatusCode = 400
			return resp, nil
		}
		return jsonResponse(r, `{"id":"published"}`), nil
	})}
	req := &PublishRequest{}
	var stored PublishResult
	req.SetWriteFence(nil, func(r PublishResult) error { stored = r; return nil })
	adapter := NewInstagramAdapter("", "", "")
	result, err := adapter.ResumePublish(t.Context(), "token", "ig", req, "ig1:f:container")
	if result.SubmissionState != PublishSubmissionPending || result.ProviderReference != "ig1:f:container" || stored.ProviderReference != "ig1:f:container" {
		t.Fatalf("readiness rejection must retain reusable container: result=%+v stored=%+v err=%v", result, stored, err)
	}
	calls = 5
	result, err = adapter.ResumePublish(t.Context(), "token", "ig", req, result.ProviderReference)
	if err != nil || result.ExternalID != "published" {
		t.Fatalf("resuming confirmed readiness rejection: result=%+v err=%v", result, err)
	}
}

func TestInstagramStoryContainerCreateRejectionIsDefinite(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	defer func() { httpClient = original }()
	published := false
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/v25.0/ig-1/media":
			resp := jsonResponse(r, `{"error":{"code":100,"message":"The param alt_text is not supported for STORY"}}`)
			resp.StatusCode = http.StatusBadRequest
			return resp, nil
		case "/v25.0/ig-1/media_publish":
			published = true
			return jsonResponse(r, `{"id":"story-1"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
			return nil, nil
		}
	})}
	req := &PublishRequest{
		Profile:          "story",
		PlatformMediaIDs: []string{"https://media.example/story.jpg"},
		Media:            []MediaItem{{MimeType: "image/jpeg"}},
	}
	result, err := NewInstagramAdapter("", "", "").Publish(t.Context(), "token", "ig-1", req)
	if published {
		t.Fatal("a rejected story container must never be published")
	}
	if err == nil {
		t.Fatal("expected the container rejection to surface")
	}
	if result.SubmissionState != PublishSubmissionRejected || result.RetrySafety != PublishRetryNever {
		t.Fatalf("story container rejection must be definite, got %#v (err %v)", result, err)
	}
	if result.ProviderReference != "ig1:u:0:-:-" {
		t.Fatalf("rejection must retain the create checkpoint, got %q", result.ProviderReference)
	}
}

func TestInstagramResumeStoryCreateCheckpointRecreatesContainer(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	defer func() { httpClient = original }()
	created := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/v25.0/ig-1/media":
			created++
			return jsonResponse(r, `{"id":"container-2"}`), nil
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
			return nil, nil
		}
	})}
	req := &PublishRequest{
		Profile:          "story",
		PlatformMediaIDs: []string{"https://media.example/story.jpg"},
		Media:            []MediaItem{{MimeType: "image/jpeg"}},
	}
	result, err := NewInstagramAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", req, "ig1:u:0:-:-")
	if err != nil {
		t.Fatalf("resuming a create checkpoint: %v", err)
	}
	if created != 1 {
		t.Fatalf("a create checkpoint without a container must retry creation, got %d requests", created)
	}
	if result.SubmissionState != PublishSubmissionPending || result.ProviderReference != "ig1:s:0:-:container-2" {
		t.Fatalf("unexpected resumed create result: %#v", result)
	}
}

func TestInstagramPublish10033AfterPublishIntentRemainsPending(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	var requests []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.Method+" "+req.URL.Path)
		switch req.URL.Path {
		case "/v25.0/ig-1/media":
			return jsonResponse(req, `{"id":"container-1"}`), nil
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/ig-1/media_publish":
			return jsonResponseWithStatus(req, http.StatusBadRequest, `{"error":{"message":"Object does not exist","code":100,"error_subcode":33}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}
	var checkpoints []PublishResult
	req := &PublishRequest{Content: "Launch", PlatformMediaIDs: []string{"https://media.example/photo.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}}}
	req.SetWriteFence(nil, func(result PublishResult) error { checkpoints = append(checkpoints, result); return nil })
	result, err := NewInstagramLoginAdapter("", "", "").Publish(t.Context(), "token", "ig-1", req)
	if err == nil {
		t.Fatal("expected the provider error to remain visible")
	}
	if result.SubmissionState != PublishSubmissionPending || result.ProviderReference != "ig1:p:container-1" || result.RetrySafety != PublishRetryReconcileOnly {
		t.Fatalf("ambiguous publish result must remain pending and fenced, got %#v", result)
	}
	if len(checkpoints) < 2 || checkpoints[len(checkpoints)-1].ProviderReference != "ig1:p:container-1" {
		t.Fatalf("publish intent checkpoint was not retained: %#v", checkpoints)
	}
	if strings.Join(requests, ",") != "POST /v25.0/ig-1/media,GET /v25.0/container-1,POST /v25.0/ig-1/media_publish" {
		t.Fatalf("unexpected write sequence: %v", requests)
	}
	requests = nil
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.Method+" "+req.URL.Path)
		switch req.URL.Path {
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
		case "/v25.0/ig-1/media":
			return jsonResponse(req, `{"data":[{"id":"published-1","caption":"Launch","media_type":"IMAGE"}]}`), nil
		default:
			t.Fatalf("reconciliation must not write: %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}
	result, err = NewInstagramLoginAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", req, result.ProviderReference)
	if err != nil || result.SubmissionState != PublishSubmissionAccepted || result.ExternalID != "published-1" {
		t.Fatalf("authoritative PUBLISHED status should confirm the post: %#v, %v", result, err)
	}
	if strings.Join(requests, ",") != "GET /v25.0/container-1,GET /v25.0/ig-1/media" {
		t.Fatalf("resume must only read provider state: %v", requests)
	}
}

func TestInstagramStoryPublish10033KeepsSequenceCheckpoint(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	var requests []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.Method+" "+req.URL.Path)
		switch req.URL.Path {
		case "/v25.0/ig-1/media":
			return jsonResponse(req, `{"id":"container-1"}`), nil
		case "/v25.0/container-1":
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/ig-1/media_publish":
			return jsonResponseWithStatus(req, http.StatusBadRequest, `{"error":{"message":"Object unavailable","code":100,"error_subcode":33}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.Path)
			return nil, nil
		}
	})}
	req := &PublishRequest{Profile: "story", PlatformMediaIDs: []string{"https://media.example/one.jpg", "https://media.example/two.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}, {MimeType: "image/jpeg"}}}
	result, err := NewInstagramLoginAdapter("", "", "").Publish(t.Context(), "token", "ig-1", req)
	if err == nil {
		t.Fatal("expected ambiguous provider response")
	}
	if result.SubmissionState != PublishSubmissionPending || result.ProviderReference != "ig1:t:0:-:container-1" || result.RetrySafety != PublishRetryReconcileOnly {
		t.Fatalf("ambiguous story publish lost its sequence: %#v", result)
	}
	if strings.Join(requests, ",") != "POST /v25.0/ig-1/media,GET /v25.0/container-1,POST /v25.0/ig-1/media_publish" {
		t.Fatalf("unexpected writes: %v", requests)
	}
}

func TestInstagramAlreadyPublishedContainerDoesNotPublishAgain(t *testing.T) {
	for _, profile := range []string{"post", "story"} {
		t.Run(profile, func(t *testing.T) {
			original := httpClient
			t.Cleanup(func() { httpClient = original })
			var requests []string
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				requests = append(requests, req.Method+" "+req.URL.Path)
				switch req.URL.Path {
				case "/v25.0/ig-1/media":
					return jsonResponse(req, `{"id":"container-1"}`), nil
				case "/v25.0/container-1":
					return jsonResponse(req, `{"status_code":"PUBLISHED"}`), nil
				default:
					t.Fatalf("must not publish an already published container: %s %s", req.Method, req.URL.Path)
					return nil, nil
				}
			})}
			req := &PublishRequest{Profile: profile, PlatformMediaIDs: []string{"https://media.example/one.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}}}
			result, _ := NewInstagramLoginAdapter("", "", "").Publish(t.Context(), "token", "ig-1", req)
			if result.SubmissionState != PublishSubmissionPending || result.RetrySafety != PublishRetryReconcileOnly {
				t.Fatalf("expected read-only reconciliation, got %#v", result)
			}
			if strings.Join(requests, ",") != "POST /v25.0/ig-1/media,GET /v25.0/container-1" {
				t.Fatalf("unexpected requests: %v", requests)
			}
			wantReference := "ig1:p:container-1"
			if profile == "story" {
				wantReference = "ig1:t:0:-:container-1"
			}
			if result.ProviderReference != wantReference {
				t.Fatalf("lost published state: %#v", result)
			}
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if req.Method != "GET" || req.URL.Path != "/v25.0/container-1" {
					t.Fatalf("must not repeat publish on resume: %s %s", req.Method, req.URL.Path)
				}
				return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
			})}
			resumed, resumeErr := NewInstagramLoginAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", req, result.ProviderReference)
			if resumeErr != nil || resumed.SubmissionState != PublishSubmissionPending {
				t.Fatalf("must remain read-only when status is inconsistent: %#v %v", resumed, resumeErr)
			}
		})
	}
}
