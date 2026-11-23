package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
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

func TestInstagramPrivateReplyAddressesCommentInBothLoginModes(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, direct := range []bool{false, true} {
		t.Run(map[bool]string{false: "facebook login", true: "instagram login"}[direct], func(t *testing.T) {
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				host := "graph.facebook.com"
				if direct {
					host = "graph.instagram.com"
				}
				require.Equal(t, host, req.URL.Host)
				require.Contains(t, req.URL.Path, "/owner/messages")
				require.Equal(t, "Bearer private-token", req.Header.Get("Authorization"))
				var body map[string]any
				require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
				require.Equal(t, map[string]any{"comment_id": "comment-42"}, body["recipient"])
				require.Equal(t, map[string]any{"text": "Here is your playbook: https://example.test/book"}, body["message"])
				return jsonResponse(req, `{"recipient_id":"reader","message_id":"dm-42"}`), nil
			})}
			adapter := NewInstagramAdapter("", "", "")
			adapter.instagramLogin = direct
			id, err := adapter.ReplyPrivatelyToComment(context.Background(), "private-token", "owner", "comment-42", "Here is your playbook: https://example.test/book")
			require.NoError(t, err)
			require.Equal(t, "dm-42", id)
		})
	}
}

func TestInstagramPublishFailureLogsSafeRequestStage(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		switch req.URL.Path {
		case "/v25.0/12345/media":
			return jsonResponse(req, `{"id":"67890"}`), nil
		case "/v25.0/67890":
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/12345/media_publish":
			return jsonResponseWithStatus(req, 400, `{"error":{"code":100,"error_subcode":33,"fbtrace_id":"trace-safe","message":"secret-provider-body"}}`), nil
		default:
			return nil, fmt.Errorf("unexpected request")
		}
	})}
	_, err := NewInstagramLoginAdapter("", "", "").Publish(t.Context(), "secret-token", "12345", &PublishRequest{
		Content: "secret-caption", PlatformMediaIDs: []string{"https://media.example/secret-file.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}},
	})
	require.Error(t, err)
	require.Equal(t, 3, calls)
	for _, diagnostic := range []string{`host="graph.instagram.com"`, `operation="media_publish"`, `endpoint="/{ig_user_id}/media_publish"`, `object_id="67890"`, `status=400`, `subcode="33"`, `trace="trace-safe"`} {
		require.Contains(t, output.String(), diagnostic)
	}
	for _, secret := range []string{"secret-token", "secret-caption", "secret-provider-body", "secret-file"} {
		require.NotContains(t, output.String(), secret)
	}
}

// GET /{ig-media-id}/comments returns only top-level comments. Replies are
// omitted unless the replies field is expanded. A follower answering the
// account's own reply never reaches the inbox without that expansion, and
// ParentID must be the comment the reply answers.
func TestInstagramListCommentsCollectsNestedReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.True(t, strings.HasSuffix(req.URL.Path, "/media-1/comments"), req.URL.Path)
		if !strings.Contains(req.URL.Query().Get("fields"), "replies") {
			return jsonResponse(req, `{
				"data": [
					{"id":"c1","text":"Does it support video?","timestamp":"2026-09-14T10:00:00+0000","username":"fan"}
				]
			}`), nil
		}
		return jsonResponse(req, `{
			"data": [{
				"id": "c1",
				"text": "Does it support video?",
				"timestamp": "2026-09-14T10:00:00+0000",
				"username": "fan",
				"replies": {
					"data": [
						{"id":"c2","text":"Yes, up to five minutes.","timestamp":"2026-09-14T10:05:00+0000","username":"openpost","parent_id":"c1"},
						{"id":"c3","text":"And carousels?","timestamp":"2026-09-14T10:10:00+0000","username":"fan","parent_id":"c1"}
					]
				}
			}]
		}`), nil
	})}

	comments, err := NewInstagramAdapter("", "", "").ListComments(context.Background(), "ig-token", "ig-1", "media-1")

	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 3)
	require.Empty(t, byID["c1"].ParentID, "a top-level comment answers the media")
	require.Equal(t, "c1", byID["c2"].ParentID, "the account reply must be threaded under the comment it answers")
	require.Equal(t, "c1", byID["c3"].ParentID, "Instagram attaches a follow-up to the top-level comment")
	require.Equal(t, "openpost", byID["c2"].AuthorName)
	require.Equal(t, "fan", byID["c3"].AuthorName)
}

func TestInstagramResumeCarouselRateLimitBacksOff(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	t.Cleanup(func() { httpClient = original })

	req := &PublishRequest{
		PlatformMediaIDs: []string{"https://media.example/1.jpg", "https://media.example/2.jpg"},
		Media:            []MediaItem{{MimeType: "image/jpeg"}, {MimeType: "image/jpeg"}},
	}

	t.Run("default 15m backoff on Meta code 4", func(t *testing.T) {
		httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return jsonResponseWithStatus(r, http.StatusForbidden, `{"error":{"code":4,"message":"Application request limit reached"}}`), nil
		})}
		result, err := NewInstagramAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", req, "ig1:d:child-1")
		require.Error(t, err)
		require.Equal(t, PublishSubmissionPending, result.SubmissionState)
		require.Equal(t, 15*time.Minute, result.ReconcileAfter)
	})

	t.Run("honors X-Business-Use-Case-Usage regain window", func(t *testing.T) {
		httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			resp := jsonResponseWithStatus(r, http.StatusForbidden, `{"error":{"code":80002,"message":"Rate limit"}}`)
			resp.Header.Set("X-Business-Use-Case-Usage", `{"ig-1":[{"type":"instagram","estimated_time_to_regain_access":25}]}`)
			return resp, nil
		})}
		result, err := NewInstagramAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", req, "ig1:d:child-1")
		require.Error(t, err)
		require.Equal(t, PublishSubmissionPending, result.SubmissionState)
		require.Equal(t, 25*time.Minute, result.ReconcileAfter)
	})
}

func TestInstagramResumeCarouselCreateCheckpointsAdvance(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	original := httpClient
	t.Cleanup(func() { httpClient = original })

	req := &PublishRequest{
		Content:          "Carousel caption",
		PlatformMediaIDs: []string{"https://media.example/1.jpg", "https://media.example/2.jpg"},
		Media:            []MediaItem{{MimeType: "image/jpeg"}, {MimeType: "image/jpeg"}},
	}

	t.Run("child create checkpoint retries missing child instead of looping forever", func(t *testing.T) {
		created := 0
		httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/v25.0/child-1":
				return jsonResponse(r, `{"status_code":"FINISHED"}`), nil
			case r.Method == http.MethodPost && r.URL.Path == "/v25.0/ig-1/media":
				created++
				return jsonResponse(r, `{"id":"child-2"}`), nil
			default:
				t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				return nil, nil
			}
		})}
		result, err := NewInstagramAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", req, "ig1:d:child-1")
		require.NoError(t, err)
		require.Equal(t, 1, created)
		require.Equal(t, PublishSubmissionPending, result.SubmissionState)
		require.Equal(t, "ig1:c:child-1,child-2", result.ProviderReference)
	})

	t.Run("parent create checkpoint retries carousel parent creation", func(t *testing.T) {
		created := 0
		httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			switch {
			case r.Method == http.MethodGet && (r.URL.Path == "/v25.0/child-1" || r.URL.Path == "/v25.0/child-2"):
				return jsonResponse(r, `{"status_code":"FINISHED"}`), nil
			case r.Method == http.MethodPost && r.URL.Path == "/v25.0/ig-1/media":
				created++
				return jsonResponse(r, `{"id":"parent-1"}`), nil
			default:
				t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				return nil, nil
			}
		})}
		result, err := NewInstagramAdapter("", "", "").ResumePublish(t.Context(), "token", "ig-1", req, "ig1:a:child-1,child-2")
		require.NoError(t, err)
		require.Equal(t, 1, created)
		require.Equal(t, PublishSubmissionPending, result.SubmissionState)
		require.Equal(t, "ig1:f:parent-1", result.ProviderReference)
	})
}
