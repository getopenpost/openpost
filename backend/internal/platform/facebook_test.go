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

func TestFacebookListAccountSelectionsExplainsPageAccessRequirement(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v25.0/me/accounts" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		return jsonResponse(req, `{"data":[]}`), nil
	})}

	_, err := NewFacebookAdapter("", "", "").ListAccountSelections(
		context.Background(),
		&TokenResult{AccessToken: "access-token"},
	)
	if err == nil || !strings.Contains(err.Error(), "give this profile full control") {
		t.Fatalf("expected Facebook Page access guidance, got %v", err)
	}
}

func TestFacebookListCommentsMapsGraphResponse(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || req.URL.Path != "/v25.0/page-post-1/comments" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if req.URL.Query().Get(oauthParamAccessToken) != "page-token" {
			t.Fatalf("unexpected access token %q", req.URL.Query().Get(oauthParamAccessToken))
		}
		fields := req.URL.Query().Get("fields")
		for _, field := range []string{"id", "from", "message", "created_time", "is_hidden", "can_hide", "can_comment"} {
			if !strings.Contains(fields, field) {
				t.Fatalf("expected fields to include %s, got %q", field, fields)
			}
		}
		return jsonResponse(req, `{"data":[{"id":"comment-1","message":"Looks good","created_time":"2026-07-04T10:00:00+0000","is_hidden":true,"can_hide":true,"can_comment":true,"from":{"id":"user-1","name":"Rita"}}]}`), nil
	})}

	comments, err := NewFacebookAdapter("", "", "").ListComments(context.Background(), "page-token", "page-1", "page-post-1")
	if err != nil {
		t.Fatalf("ListComments returned error: %v", err)
	}
	if len(comments) != 1 {
		t.Fatalf("expected one comment, got %#v", comments)
	}
	comment := comments[0]
	if comment.ID != "comment-1" || comment.AuthorID != "user-1" || comment.AuthorName != "Rita" || comment.Text != "Looks good" || !comment.Hidden || !comment.CanReply || !comment.CanHide || !comment.CanDelete {
		t.Fatalf("unexpected comment mapping: %#v", comment)
	}
}

func TestFacebookCommentActions(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	calls := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls = append(calls, req.Method+" "+req.URL.Path)
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/v25.0/comment-1/comments":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading reply body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing reply body: %v", err)
			}
			if form.Get("message") != "Thanks" || form.Get(oauthParamAccessToken) != "page-token" {
				t.Fatalf("unexpected reply form %#v", form)
			}
			return jsonResponse(req, `{"id":"reply-1"}`), nil
		case req.Method == http.MethodPost && req.URL.Path == "/v25.0/comment-1":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading hide body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing hide body: %v", err)
			}
			if form.Get("is_hidden") != "true" || form.Get(oauthParamAccessToken) != "page-token" {
				t.Fatalf("unexpected hide form %#v", form)
			}
			return jsonResponse(req, `{"success":true}`), nil
		case req.Method == http.MethodDelete && req.URL.Path == "/v25.0/comment-1":
			if req.URL.Query().Get(oauthParamAccessToken) != "page-token" {
				t.Fatalf("unexpected delete token %q", req.URL.Query().Get(oauthParamAccessToken))
			}
			return jsonResponse(req, `{"success":true}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewFacebookAdapter("", "", "")
	replyID, err := adapter.ReplyToComment(context.Background(), "page-token", "page-1", "comment-1", " Thanks ")
	if err != nil {
		t.Fatalf("ReplyToComment returned error: %v", err)
	}
	if replyID != "reply-1" {
		t.Fatalf("expected reply ID, got %q", replyID)
	}
	if err := adapter.HideComment(context.Background(), "page-token", "page-1", "comment-1"); err != nil {
		t.Fatalf("HideComment returned error: %v", err)
	}
	if err := adapter.DeleteComment(context.Background(), "page-token", "page-1", "comment-1"); err != nil {
		t.Fatalf("DeleteComment returned error: %v", err)
	}
	if strings.Join(calls, ",") != "POST /v25.0/comment-1/comments,POST /v25.0/comment-1,DELETE /v25.0/comment-1" {
		t.Fatalf("unexpected call order %#v", calls)
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
