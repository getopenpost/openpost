package platform

import (
	"context"

	"net/http"

	"strings"
	"testing"
)

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
