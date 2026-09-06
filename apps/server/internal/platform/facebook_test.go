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

func TestFacebookGenerateAuthURL(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	adapter := NewFacebookAdapter("client-id", "client-secret", "https://app.example/api/v1/accounts/facebook/callback")

	authURL, _ := adapter.GenerateAuthURL("state-123")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parsing auth url: %v", err)
	}

	if parsed.Scheme != "https" || parsed.Host != "www.facebook.com" || parsed.Path != "/v25.0/dialog/oauth" {
		t.Fatalf("unexpected auth url %s", authURL)
	}
	query := parsed.Query()
	if query.Get(oauthParamClientID) != "client-id" {
		t.Fatalf("expected client id, got %q", query.Get(oauthParamClientID))
	}
	if query.Get("response_type") != oauthResponseType {
		t.Fatalf("unexpected response_type %q", query.Get("response_type"))
	}
	if !strings.Contains(query.Get("scope"), "pages_manage_posts") {
		t.Fatalf("expected pages_manage_posts scope, got %q", query.Get("scope"))
	}
	for _, scope := range []string{"pages_manage_engagement", "pages_messaging"} {
		if !strings.Contains(query.Get("scope"), scope) {
			t.Fatalf("expected %s scope, got %q", scope, query.Get("scope"))
		}
	}
	if !strings.Contains(query.Get("scope"), "business_management") {
		t.Fatalf("expected business_management scope for Business Portfolio Pages, got %q", query.Get("scope"))
	}
}

func TestFacebookExchangeAndSelectPage(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	accountsCalls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/oauth/access_token":
			query := req.URL.Query()
			switch query.Get(grantType) {
			case "fb_exchange_token":
				if query.Get("fb_exchange_token") != "short-token" {
					t.Fatalf("unexpected fb_exchange_token %q", query.Get("fb_exchange_token"))
				}
				return jsonResponse(req, `{"access_token":"long-token","token_type":"bearer","expires_in":5184000}`), nil
			default:
				if query.Get(oauthParamCode) != "auth-code" {
					t.Fatalf("unexpected code %q", query.Get(oauthParamCode))
				}
				return jsonResponse(req, `{"access_token":"short-token","token_type":"bearer","expires_in":3600}`), nil
			}
		case "/v25.0/me/accounts":
			accountsCalls++
			if req.URL.Query().Get(oauthParamAccessToken) != "long-token" {
				t.Fatalf("unexpected accounts token %q", req.URL.Query().Get(oauthParamAccessToken))
			}
			return jsonResponse(req, `{"data":[{"id":"page-1","name":"OpenPost Page","username":"openpost","access_token":"page-token","picture":{"data":{"url":"https://cdn.example/page.png"}}}]}`), nil
		case "/v25.0/me/permissions":
			return jsonResponse(req, `{"data":[{"permission":"pages_show_list","status":"granted"},{"permission":"pages_read_engagement","status":"granted"},{"permission":"pages_manage_posts","status":"granted"},{"permission":"declined_scope","status":"declined"}]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewFacebookAdapter("client-id", "client-secret", "https://app.example/callback")
	token, err := adapter.ExchangeCode(context.Background(), "auth-code", nil)
	if err != nil {
		t.Fatalf("ExchangeCode returned error: %v", err)
	}
	if token.AccessToken != "long-token" || token.ExpiresIn != 5184000 {
		t.Fatalf("unexpected token: %#v", token)
	}
	if !strings.Contains(token.Extra["scope"], "pages_read_engagement") {
		t.Fatalf("expected granted Facebook scopes, got %#v", token.Extra)
	}

	options, err := adapter.ListAccountSelections(context.Background(), token)
	if err != nil {
		t.Fatalf("ListAccountSelections returned error: %v", err)
	}
	if len(options) != 1 || options[0].ID != "page-1" || options[0].Username != "openpost" {
		t.Fatalf("unexpected options: %#v", options)
	}

	selected, err := adapter.SelectAccount(context.Background(), token, "page-1")
	if err != nil {
		t.Fatalf("SelectAccount returned error: %v", err)
	}
	if selected.AccountID != "page-1" || selected.Token.AccessToken != "page-token" || selected.Token.ExpiresIn != 0 {
		t.Fatalf("unexpected selected account: %#v", selected)
	}
	if !strings.Contains(selected.Token.Extra["scope"], "pages_read_engagement") {
		t.Fatalf("expected selected account to preserve scopes, got %#v", selected.Token.Extra)
	}
	if accountsCalls != 2 {
		t.Fatalf("expected two accounts calls, got %d", accountsCalls)
	}
}

func TestFacebookPublishPhotoFromPublicURL(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var form url.Values
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v25.0/page-1/photos" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("reading publish body: %v", err)
		}
		form, err = url.ParseQuery(string(body))
		if err != nil {
			t.Fatalf("parsing publish form: %v", err)
		}
		return jsonResponse(req, `{"id":"photo-1","post_id":"page-1_post-1"}`), nil
	})}

	adapter := NewFacebookAdapter("client-id", "client-secret", "https://app.example/callback")
	externalID, err := adapter.Publish(context.Background(), "page-token", "page-1", &PublishRequest{
		Content:          "Launch photo",
		PlatformMediaIDs: []string{"https://media.example/photo.jpg"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
	})
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}
	if externalID.ExternalID != "page-1_post-1" {
		t.Fatalf("expected post id, got %q", externalID)
	}
	if form.Get("url") != "https://media.example/photo.jpg" || form.Get("caption") != "Launch photo" || form.Get(oauthParamAccessToken) != "page-token" {
		t.Fatalf("unexpected publish form: %s", form.Encode())
	}
}

func TestFacebookPublishRejectsNonHTTPSMediaURL(t *testing.T) {
	adapter := NewFacebookAdapter("client-id", "client-secret", "https://app.example/callback")
	_, err := adapter.Publish(context.Background(), "page-token", "page-1", &PublishRequest{
		Content:          "Launch photo",
		PlatformMediaIDs: []string{"http://media.example/photo.jpg"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
	})
	if err == nil || !strings.Contains(err.Error(), "publicly-accessible HTTPS") {
		t.Fatalf("expected HTTPS URL error, got %v", err)
	}
}

func TestFacebookPublishNormalizesMetaFailures(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	tests := []struct {
		name       string
		body       string
		statusCode int
		code       string
	}{
		{name: "expired token", body: `{"error":{"code":190}}`, statusCode: http.StatusUnauthorized, code: "meta:token_expired:190"},
		{name: "permission", body: `{"error":{"code":10}}`, statusCode: http.StatusForbidden, code: "meta:permission:10"},
		{name: "rate limit", body: `{"error":{"code":4}}`, statusCode: http.StatusTooManyRequests, code: "meta:rate_limit:4"},
		{name: "generic rejection", body: `{"error":{"code":1}}`, statusCode: http.StatusBadRequest, code: "meta:rejected:1"},
		{name: "transient", body: `{"error":{"code":2}}`, statusCode: http.StatusServiceUnavailable, code: "meta:transient:2"},
		{name: "other", body: `{"error":{"code":100}}`, statusCode: http.StatusBadRequest, code: "meta:100"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusBadRequest,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(test.body)),
					Request:    req,
				}, nil
			})}

			_, err := NewFacebookAdapter("", "", "").Publish(t.Context(), "page-token", "page-1", &PublishRequest{Content: "Launch"})
			var providerErr *HTTPError
			if !errors.As(err, &providerErr) {
				t.Fatalf("expected typed provider error, got %v", err)
			}
			if providerErr.StatusCode != test.statusCode || providerErr.Code != test.code {
				t.Fatalf("unexpected normalized error: %#v", providerErr)
			}
		})
	}
}

func TestFacebookPublishedIDRejectsGraphError(t *testing.T) {
	_, err := facebookPublishedID("facebook publish", []byte(`{"error":{"message":"missing permission"}}`))
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) || providerErr.Code != "facebook_publish_error" {
		t.Fatalf("expected graph error, got %v", err)
	}
	if strings.Contains(err.Error(), "missing permission") {
		t.Fatalf("provider response message leaked: %v", err)
	}
}

func TestFacebookPublishedIDParsesID(t *testing.T) {
	body, err := json.Marshal(map[string]string{"id": "post-1"})
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	got, err := facebookPublishedID("facebook publish", body)
	if err != nil {
		t.Fatalf("facebookPublishedID returned error: %v", err)
	}
	if got != "post-1" {
		t.Fatalf("expected post-1, got %q", got)
	}
}
