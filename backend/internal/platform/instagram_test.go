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
	if query.Get(oauthParamClientID) != "client-id" {
		t.Fatalf("expected client id, got %q", query.Get(oauthParamClientID))
	}
	if !strings.Contains(query.Get("scope"), "instagram_content_publish") {
		t.Fatalf("expected instagram_content_publish scope, got %q", query.Get("scope"))
	}
	for _, scope := range []string{"instagram_manage_comments", "instagram_manage_messages"} {
		if !strings.Contains(query.Get("scope"), scope) {
			t.Fatalf("expected %s scope, got %q", scope, query.Get("scope"))
		}
	}
	if strings.Contains(query.Get("scope"), "business_management") {
		t.Fatalf("did not expect unrelated business_management scope, got %q", query.Get("scope"))
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
			query := req.URL.Query()
			if query.Get(grantType) == "fb_exchange_token" {
				return jsonResponse(req, `{"access_token":"long-token","token_type":"bearer","expires_in":5184000}`), nil
			}
			return jsonResponse(req, `{"access_token":"short-token","token_type":"bearer","expires_in":3600}`), nil
		case "/v25.0/me/accounts":
			accountsCalls++
			if req.URL.Query().Get(oauthParamAccessToken) != "long-token" {
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

func TestInstagramListAccountSelectionsExplainsFacebookPageLinkRequirement(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v25.0/me/accounts" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		return jsonResponse(req, `{"data":[]}`), nil
	})}

	_, err := NewInstagramAdapter("", "", "").ListAccountSelections(
		context.Background(),
		&TokenResult{AccessToken: "access-token"},
	)
	if err == nil || !strings.Contains(err.Error(), "Accounts Center profile links do not provide this access") {
		t.Fatalf("expected Facebook Page link guidance, got %v", err)
	}
}

func TestInstagramListCommentsMapsGraphResponse(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || req.URL.Path != "/v25.0/ig-media-1/comments" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if req.URL.Query().Get(oauthParamAccessToken) != "ig-token" {
			t.Fatalf("unexpected access token %q", req.URL.Query().Get(oauthParamAccessToken))
		}
		fields := req.URL.Query().Get("fields")
		for _, field := range []string{"id", "text", "timestamp", "username", "hidden"} {
			if !strings.Contains(fields, field) {
				t.Fatalf("expected fields to include %s, got %q", field, fields)
			}
		}
		return jsonResponse(req, `{"data":[{"id":"ig-comment-1","text":"Nice launch","timestamp":"2026-07-04T10:00:00+0000","username":"rita","hidden":false}]}`), nil
	})}

	comments, err := NewInstagramAdapter("", "", "").ListComments(context.Background(), "ig-token", "ig-1", "ig-media-1")
	if err != nil {
		t.Fatalf("ListComments returned error: %v", err)
	}
	if len(comments) != 1 {
		t.Fatalf("expected one comment, got %#v", comments)
	}
	comment := comments[0]
	if comment.ID != "ig-comment-1" || comment.AuthorName != "rita" || comment.Text != "Nice launch" || comment.Hidden || !comment.CanReply || !comment.CanHide || !comment.CanDelete {
		t.Fatalf("unexpected comment mapping: %#v", comment)
	}
}

func TestInstagramCommentActions(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	calls := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls = append(calls, req.Method+" "+req.URL.Path)
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/v25.0/ig-comment-1/replies":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading reply body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing reply body: %v", err)
			}
			if form.Get("message") != "Thanks" || form.Get(oauthParamAccessToken) != "ig-token" {
				t.Fatalf("unexpected reply form %#v", form)
			}
			return jsonResponse(req, `{"id":"ig-reply-1"}`), nil
		case req.Method == http.MethodPost && req.URL.Path == "/v25.0/ig-comment-1":
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("reading hide body: %v", err)
			}
			form, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("parsing hide body: %v", err)
			}
			if form.Get("hide") != "true" || form.Get(oauthParamAccessToken) != "ig-token" {
				t.Fatalf("unexpected hide form %#v", form)
			}
			return jsonResponse(req, `{"success":true}`), nil
		case req.Method == http.MethodDelete && req.URL.Path == "/v25.0/ig-comment-1":
			if req.URL.Query().Get(oauthParamAccessToken) != "ig-token" {
				t.Fatalf("unexpected delete token %q", req.URL.Query().Get(oauthParamAccessToken))
			}
			return jsonResponse(req, `{"success":true}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewInstagramAdapter("", "", "")
	replyID, err := adapter.ReplyToComment(context.Background(), "ig-token", "ig-1", "ig-comment-1", " Thanks ")
	if err != nil {
		t.Fatalf("ReplyToComment returned error: %v", err)
	}
	if replyID != "ig-reply-1" {
		t.Fatalf("expected reply ID, got %q", replyID)
	}
	if err := adapter.HideComment(context.Background(), "ig-token", "ig-1", "ig-comment-1"); err != nil {
		t.Fatalf("HideComment returned error: %v", err)
	}
	if err := adapter.DeleteComment(context.Background(), "ig-token", "ig-1", "ig-comment-1"); err != nil {
		t.Fatalf("DeleteComment returned error: %v", err)
	}
	if strings.Join(calls, ",") != "POST /v25.0/ig-comment-1/replies,POST /v25.0/ig-comment-1,DELETE /v25.0/ig-comment-1" {
		t.Fatalf("unexpected call order %#v", calls)
	}
}

func TestInstagramPublishImageFromPublicURL(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var createForm url.Values
	var publishForm url.Values
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v25.0/ig-1/media":
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
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/ig-1/media_publish":
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
	externalID, err := adapter.Publish(context.Background(), "page-token", "ig-1", &PublishRequest{
		Content:          "Launch image",
		PlatformMediaIDs: []string{"https://media.example/image.jpg"},
		Media:            []MediaItem{{ID: "media-1", MimeType: "image/jpeg"}},
	})
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

func TestInstagramTrialReelUsesTrialParams(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var createForm url.Values
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.Path != "/v25.0/ig-1/media" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("reading create body: %v", err)
		}
		createForm, err = url.ParseQuery(string(body))
		if err != nil {
			t.Fatalf("parsing create form: %v", err)
		}
		return jsonResponse(req, `{"id":"container-1"}`), nil
	})}

	adapter := NewInstagramAdapter("", "", "")
	_, err := adapter.createMediaContainer(
		context.Background(),
		"page-token",
		"ig-1",
		"Trial",
		"https://media.example/reel.mp4",
		true,
		false,
		&PublishRequest{
			Profile:       "short_video",
			OutputProfile: "instagram.reel",
			Settings: map[string]interface{}{
				"is_trial_reel":       true,
				"graduation_strategy": "SS_PERFORMANCE",
			},
		},
		nil,
		"",
	)
	if err != nil {
		t.Fatalf("createMediaContainer returned error: %v", err)
	}
	if createForm.Get("is_trial_reel") != "" || createForm.Get("graduation_strategy") != "" {
		t.Fatalf("trial reel fields must be nested: %#v", createForm)
	}
	var trialParams map[string]string
	if err := json.Unmarshal([]byte(createForm.Get("trial_params")), &trialParams); err != nil {
		t.Fatalf("decoding trial_params: %v", err)
	}
	if trialParams["graduation_strategy"] != "SS_PERFORMANCE" {
		t.Fatalf("unexpected trial_params %#v", trialParams)
	}
}

func TestInstagramMediaTagsRequireStructuredCoordinates(t *testing.T) {
	encoded, err := instagramMediaTags(
		`[{"username":"rita","x":0.25,"y":0.75}]`,
		"username",
		20,
		true,
	)
	if err != nil {
		t.Fatalf("instagramMediaTags returned error: %v", err)
	}
	var tags []map[string]interface{}
	if err := json.Unmarshal([]byte(encoded), &tags); err != nil {
		t.Fatalf("decoding normalized tags: %v", err)
	}
	if len(tags) != 1 || tags[0]["username"] != "rita" || tags[0]["x"] != 0.25 || tags[0]["y"] != 0.75 {
		t.Fatalf("unexpected normalized tags %#v", tags)
	}

	_, err = instagramMediaTags(`[{"username":"rita"}]`, "username", 20, true)
	if err == nil || !strings.Contains(err.Error(), "missing x") {
		t.Fatalf("expected missing coordinate error, got %v", err)
	}
}

func TestInstagramSearchesOnlyPagesWithLocations(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || req.URL.Path != "/v25.0/pages/search" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if req.URL.Query().Get("q") != "Lisbon" || req.URL.Query().Get(oauthParamAccessToken) != "page-token" {
			t.Fatalf("unexpected location query %#v", req.URL.Query())
		}
		return jsonResponse(req, `{"data":[{"id":"page-1","name":"OpenPost Lisbon","location":{"city":"Lisbon","country":"Portugal"}},{"id":"page-2","name":"No address"}],"paging":{"cursors":{"after":"next"}}}`), nil
	})}

	page, err := NewInstagramAdapter("", "", "").SearchPublishingOptions(context.Background(), "page-token", PublishingOptionsInput{
		Source: "instagram_locations",
		Search: "Lisbon",
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("SearchPublishingOptions returned error: %v", err)
	}
	if page.NextCursor != "next" || len(page.Options) != 1 || page.Options[0].Value != "page-1" || page.Options[0].Label != "OpenPost Lisbon · Lisbon, Portugal" {
		t.Fatalf("unexpected locations page %#v", page)
	}
}
