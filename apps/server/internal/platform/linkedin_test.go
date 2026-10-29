package platform

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLinkedInGenerateAuthURLEncodesScopesWithPercentSpaces(t *testing.T) {
	adapter := NewLinkedInAdapter("client-id", "client-secret", "https://app.example/api/v1/accounts/linkedin/callback", true)

	authURL, _ := adapter.GenerateAuthURL("state-123")
	if strings.Contains(authURL, "scope=openid+profile+w_member_social") {
		t.Fatalf("linkedin auth URL used + for scope spaces: %s", authURL)
	}
	if !strings.Contains(authURL, "scope=openid%20profile%20w_member_social") {
		t.Fatalf("linkedin auth URL did not percent-encode scope spaces: %s", authURL)
	}

	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parsing auth URL: %v", err)
	}
	if parsed.Query().Get("scope") != "openid profile w_member_social" {
		t.Fatalf("unexpected parsed scope %q", parsed.Query().Get("scope"))
	}
}

func TestLinkedInGenerateAuthURLScopeSeparation(t *testing.T) {
	tests := []struct {
		name         string
		adapter      *LinkedInAdapter
		wantScopes   []string
		absentScopes []string
	}{
		{
			name:    "default: personal only",
			adapter: NewLinkedInAdapter("id", "secret", "https://app.example/callback", false),
			wantScopes: []string{
				"openid", "profile", "w_member_social", "w_member_social_feed",
			},
			absentScopes: []string{
				"r_member_social", "rw_organization_admin", "w_organization_social",
				"r_organization_social", "r_member_profileAnalytics", "r_member_postAnalytics",
			},
		},
		{
			name:    "organizations only (no analytics)",
			adapter: NewLinkedInAdapter("id", "secret", "https://app.example/callback", false, true),
			wantScopes: []string{
				"openid", "profile", "w_member_social", "w_member_social_feed",
				"rw_organization_admin", "w_organization_social", "r_organization_social",
			},
			absentScopes: []string{
				"r_member_profileAnalytics", "r_member_postAnalytics", "r_member_social",
			},
		},
		{
			name: "organizations + member analytics",
			adapter: func() *LinkedInAdapter {
				a := NewLinkedInAdapter("id", "secret", "https://app.example/callback", false, true)
				a.enableMemberAnalytics = true
				return a
			}(),
			wantScopes: []string{
				"openid", "profile", "w_member_social", "w_member_social_feed",
				"rw_organization_admin", "w_organization_social", "r_organization_social",
				"r_member_profileAnalytics", "r_member_postAnalytics",
			},
			absentScopes: []string{},
		},
		{
			name: "member analytics only (no organizations)",
			adapter: func() *LinkedInAdapter {
				a := NewLinkedInAdapter("id", "secret", "https://app.example/callback", false)
				a.enableMemberAnalytics = true
				return a
			}(),
			wantScopes: []string{
				"openid", "profile", "w_member_social", "w_member_social_feed",
				"r_member_profileAnalytics", "r_member_postAnalytics",
			},
			absentScopes: []string{
				"rw_organization_admin", "w_organization_social", "r_organization_social",
			},
		},
		{
			name: "member reads + organizations (no analytics)",
			adapter: func() *LinkedInAdapter {
				a := NewLinkedInAdapter("id", "secret", "https://app.example/callback", false, true)
				a.enableMemberReads = true
				return a
			}(),
			wantScopes: []string{
				"openid", "profile", "w_member_social", "w_member_social_feed",
				"r_member_social",
				"rw_organization_admin", "w_organization_social", "r_organization_social",
			},
			absentScopes: []string{
				"r_member_profileAnalytics", "r_member_postAnalytics",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authURL, _ := tt.adapter.GenerateAuthURL("state-123")
			parsed, err := url.Parse(authURL)
			if err != nil {
				t.Fatalf("parsing auth URL: %v", err)
			}
			scope := parsed.Query().Get("scope")
			for _, want := range tt.wantScopes {
				if !strings.Contains(" "+scope+" ", " "+want+" ") {
					t.Errorf("expected scope %q to be present in %q", want, scope)
				}
			}
			for _, absent := range tt.absentScopes {
				if strings.Contains(" "+scope+" ", " "+absent+" ") {
					t.Errorf("expected scope %q to be absent from %q", absent, scope)
				}
			}
		})
	}
}

func TestLinkedInAnalyticsSupportRespectsMemberAnalyticsToggle(t *testing.T) {
	cases := []struct {
		name       string
		options    RegistryOptions
		wantAny    bool
		wantPerson bool
		wantOrg    bool
	}{
		{name: "disabled"},
		{name: "organizations only", options: RegistryOptions{EnableLinkedInOrganizations: true}, wantAny: true, wantOrg: true},
		{name: "member analytics only", options: RegistryOptions{EnableLinkedInMemberAnalytics: true}, wantAny: true, wantPerson: true},
		{name: "organizations and member analytics", options: RegistryOptions{EnableLinkedInOrganizations: true, EnableLinkedInMemberAnalytics: true}, wantAny: true, wantPerson: true, wantOrg: true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			adapters, _, err := BuildAdapterRegistry([]AppConfig{{
				Provider: "linkedin", ClientID: "id", ClientSecret: "secret", RedirectURI: "https://app.example/callback",
			}}, tt.options)
			if err != nil {
				t.Fatal(err)
			}
			adapter := adapters["linkedin"].(*LinkedInAdapter)
			support := adapter.AnalyticsSupport()
			if support.Account != tt.wantAny || support.Content != tt.wantAny {
				t.Fatalf("unexpected overall analytics support: %+v", support)
			}
			accounts := []struct {
				name         string
				id           string
				want         bool
				accountScope string
				contentScope string
			}{
				{name: "person", id: "urn:li:person:123", want: tt.wantPerson, accountScope: "r_member_profileAnalytics", contentScope: "r_member_postAnalytics"},
				{name: "organization", id: "urn:li:organization:42", want: tt.wantOrg, accountScope: "rw_organization_admin", contentScope: "rw_organization_admin"},
			}
			for _, account := range accounts {
				t.Run(account.name, func(t *testing.T) {
					support := adapter.AnalyticsSupportForAccount(AnalyticsAccountContext{AccountID: account.id})
					if support.Account != account.want || support.Content != account.want {
						t.Fatalf("unexpected account analytics support: %+v", support)
					}
					if !account.want {
						if support.AccountUnavailable == "" || support.ContentUnavailable == "" {
							t.Fatalf("missing analytics unavailability explanation: %+v", support)
						}
						return
					}
					if !reflect.DeepEqual(support.AccountRequiredScopes, []string{account.accountScope}) {
						t.Errorf("account scopes = %v, want %s", support.AccountRequiredScopes, account.accountScope)
					}
					if !reflect.DeepEqual(support.ContentRequiredScopes, []string{account.contentScope}) {
						t.Errorf("content scopes = %v, want %s", support.ContentRequiredScopes, account.contentScope)
					}
				})
			}
		})
	}
}

func TestLinkedInCreatePostValidatesPostIDShape(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	postID := ""
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/rest/posts" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		resp := jsonResponse(req, `{}`)
		if postID != "" {
			resp.Header.Set("x-restli-id", postID)
		}
		return resp, nil
	})}
	adapter := NewLinkedInAdapter("", "", "", false, true)
	request := func() *PublishRequest {
		return &PublishRequest{Content: "Hello", Settings: map[string]interface{}{}}
	}

	postID = "urn:li:share:123456"
	id, err := adapter.createPost(context.Background(), "token", "urn:li:person:member-1", linkedInAPIVersion(), request())
	if err != nil || id != postID {
		t.Fatalf("valid post id rejected: id=%q err=%v", id, err)
	}

	for _, valid := range []string{"urn:li:ugcPost:abc_123-XYZ", "123456789"} {
		postID = valid
		if id, err := adapter.createPost(context.Background(), "token", "urn:li:person:member-1", linkedInAPIVersion(), request()); err != nil || id != valid {
			t.Fatalf("valid post id %q rejected: id=%q err=%v", valid, id, err)
		}
	}

	for _, invalid := range []string{"not-a-post-id", "urn:li:comment:123", "urn:li:share:", "https://linkedin.com/posts/123"} {
		postID = invalid
		if _, err := adapter.createPost(context.Background(), "token", "urn:li:person:member-1", linkedInAPIVersion(), request()); err == nil {
			t.Fatalf("expected malformed post id %q to be rejected", invalid)
		}
	}

	postID = ""
	id, err = adapter.createPost(context.Background(), "token", "urn:li:person:member-1", linkedInAPIVersion(), request())
	if err != nil || id != "" {
		t.Fatalf("missing post id must stay accepted for reconciliation: id=%q err=%v", id, err)
	}
}

func TestLinkedInOrganizationSelectionUsesOrganizationURN(t *testing.T) {
	for _, tt := range []struct {
		name             string
		rejectProjection bool
		logo             string
		wantAvatar       string
	}{
		{
			name:       "projected logo",
			logo:       `{"original":"urn:li:digitalmediaAsset:logo","original~":{"elements":[{"identifiers":[{"identifier":"https://media.linkedin.example/openpost.png"}]}]}}`,
			wantAvatar: "https://media.linkedin.example/openpost.png",
		},
		{
			name:             "projection rejected with plain logo URL",
			rejectProjection: true,
			logo:             `{"original":"https://media.linkedin.example/openpost.png"}`,
			wantAvatar:       "https://media.linkedin.example/openpost.png",
		},
		{
			name:             "projection rejected with unresolved logo URN",
			rejectProjection: true,
			logo:             `{"original":"urn:li:digitalmediaAsset:logo"}`,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			originalClient := httpClient
			defer func() { httpClient = originalClient }()

			organizationRequests := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				switch req.URL.Path {
				case "/v2/userinfo":
					return jsonResponse(req, `{"sub":"member-1","name":"Ada Member","given_name":"Ada","picture":"https://media.linkedin.example/ada.jpg"}`), nil
				case "/rest/organizationAcls":
					if req.URL.Query().Get("role") != "ADMINISTRATOR" || req.URL.Query().Get("state") != "APPROVED" {
						t.Fatalf("unexpected organization ACL query %s", req.URL.RawQuery)
					}
					return jsonResponse(req, `{"elements":[{"organization":"urn:li:organization:42"}],"paging":{"links":[]}}`), nil
				case "/rest/organizations":
					organizationRequests++
					if req.Header.Get("Authorization") != "Bearer member-token" || req.Header.Get("Linkedin-Version") == "" || req.Header.Get("X-Restli-Protocol-Version") != "2.0.0" {
						t.Fatal("organization lookup lost authentication or API version headers")
					}
					if req.URL.Query().Get("ids") != "List(42)" {
						t.Fatalf("unexpected organization IDs: %s", req.URL.RawQuery)
					}
					if tt.rejectProjection && req.URL.Query().Has("projection") {
						response := jsonResponse(req, `{"status":400,"code":"ILLEGAL_ARGUMENT","message":"projection parameter is not allowed for this endpoint"}`)
						response.StatusCode = http.StatusBadRequest
						return response, nil
					}
					return jsonResponse(req, `{"results":{"42":{"localizedName":"OpenPost","vanityName":"openpost","logoV2":`+tt.logo+`}},"statuses":{"42":200}}`), nil
				case "/rest/images/urn:li:image:logo":
					response := jsonResponse(req, `{"status":403,"message":"Accessing this image resource is forbidden"}`)
					response.StatusCode = http.StatusForbidden
					return response, nil
				default:
					t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
					return nil, nil
				}
			})}

			adapter := NewLinkedInAdapter("", "", "", false, true)
			token := &TokenResult{AccessToken: "member-token", Extra: map[string]string{"user_id": "member-1"}}
			wantRequests := 1
			if tt.rejectProjection {
				wantRequests = 2
			}
			t.Run("selection", func(t *testing.T) {
				options, err := adapter.ListAccountSelections(context.Background(), token)
				if err != nil {
					t.Fatalf("ListAccountSelections returned error: %v", err)
				}
				if len(options) != 2 || options[0].ID != "person:member-1" || options[1].ID != "organization:42" {
					t.Fatalf("unexpected options %#v", options)
				}
				if options[0].AvatarURL != "https://media.linkedin.example/ada.jpg" {
					t.Fatalf("unexpected personal profile avatar %#v", options[0])
				}
				if options[1].AvatarURL != tt.wantAvatar {
					t.Fatalf("unexpected organization avatar %#v", options[1])
				}
				personal, err := adapter.SelectAccount(context.Background(), token, "person:member-1")
				if err != nil {
					t.Fatalf("SelectAccount returned error: %v", err)
				}
				if personal.AccountAvatarURL != "https://media.linkedin.example/ada.jpg" {
					t.Fatalf("unexpected selected personal profile %#v", personal)
				}
				selected, err := adapter.SelectAccount(context.Background(), token, "organization:42")
				if err != nil {
					t.Fatalf("SelectAccount returned error: %v", err)
				}
				if selected.AccountID != "urn:li:organization:42" || selected.Token != token {
					t.Fatalf("unexpected selected organization %#v", selected)
				}
				if selected.AccountAvatarURL != tt.wantAvatar {
					t.Fatalf("unexpected selected organization avatar %#v", selected)
				}
				if selected.CapabilityState["linkedin_account_type"] != "organization" {
					t.Fatalf("missing organization capability state %#v", selected.CapabilityState)
				}
				if organizationRequests != 3*wantRequests {
					t.Fatalf("listing and selecting accounts made %d organization requests, want %d", organizationRequests, 3*wantRequests)
				}
			})
			t.Run("metadata refresh", func(t *testing.T) {
				organizationRequests = 0
				profile, err := adapter.RefreshAccountMetadata(context.Background(), "member-token", AccountMetadataRequest{AccountID: "urn:li:organization:42"})
				if err != nil {
					t.Fatalf("RefreshAccountMetadata returned error: %v", err)
				}
				if profile.ID != "urn:li:organization:42" || profile.Username != "openpost" || profile.AvatarURL != tt.wantAvatar {
					t.Fatalf("unexpected refreshed LinkedIn organization profile %#v", profile)
				}
				if organizationRequests != wantRequests {
					t.Fatalf("refresh made %d organization requests, want %d", organizationRequests, wantRequests)
				}
			})
		})
	}
}

func TestLinkedInOrganizationLookupPreservesFailures(t *testing.T) {
	for _, tt := range []struct {
		name         string
		status       int
		code         string
		fallback     bool
		wantRequests int
	}{
		{name: "expired token", status: http.StatusUnauthorized, code: "EXPIRED_ACCESS_TOKEN", wantRequests: 1},
		{name: "missing permission", status: http.StatusForbidden, code: "ACCESS_DENIED", wantRequests: 1},
		{name: "rate limited", status: http.StatusTooManyRequests, code: "TOO_MANY_REQUESTS", wantRequests: 1},
		{name: "other bad request", status: http.StatusBadRequest, code: "INVALID_REQUEST", wantRequests: 1},
		{name: "fallback denied", status: http.StatusForbidden, code: "ACCESS_DENIED", fallback: true, wantRequests: 2},
		{name: "fallback still invalid", status: http.StatusBadRequest, code: "ILLEGAL_ARGUMENT", fallback: true, wantRequests: 2},
	} {
		t.Run(tt.name, func(t *testing.T) {
			originalClient := httpClient
			defer func() { httpClient = originalClient }()
			requests := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path != "/rest/organizations" {
					t.Fatalf("unexpected request %s", req.URL.Path)
				}
				requests++
				if requests > tt.wantRequests {
					t.Fatal("organization lookup exceeded its request budget")
				}
				status, code := tt.status, tt.code
				if tt.fallback && req.URL.Query().Has("projection") {
					status, code = http.StatusBadRequest, "ILLEGAL_ARGUMENT"
				}
				body, err := json.Marshal(map[string]any{"status": status, "code": code})
				if err != nil {
					t.Fatal(err)
				}
				response := jsonResponse(req, string(body))
				response.StatusCode = status
				response.Header.Set("Retry-After", "60")
				return response, nil
			})}
			adapter := NewLinkedInAdapter("", "", "", false, true)
			_, err := adapter.RefreshAccountMetadata(t.Context(), "member-token", AccountMetadataRequest{AccountID: "urn:li:organization:42"})
			var providerErr *HTTPError
			if !errors.As(err, &providerErr) || providerErr.StatusCode != tt.status || providerErr.Code != tt.code || providerErr.RetryAfter != 60*time.Second {
				t.Fatalf("organization lookup lost the provider failure: %v", err)
			}
			if requests != tt.wantRequests {
				t.Fatalf("organization lookup made %d requests, want %d", requests, tt.wantRequests)
			}
		})
	}
}

func TestLinkedInUploadDocumentInitializesUploadsAndWaitsForAvailability(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	requests := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.Method+" "+req.URL.String())
		switch {
		case req.Method == "POST" && req.URL.String() == "https://api.linkedin.com/rest/documents?action=initializeUpload":
			return &http.Response{
				StatusCode: http.StatusOK,
				Body: io.NopCloser(strings.NewReader(`{
					"value": {
						"uploadUrl": "https://uploads.linkedin.example/document",
						"document": "urn:li:document:D5510AQFx87994pYx0Q"
					}
				}`)),
				Request: req,
			}, nil
		case req.Method == "PUT" && req.URL.String() == "https://uploads.linkedin.example/document":
			return &http.Response{
				StatusCode: http.StatusCreated,
				Body:       io.NopCloser(strings.NewReader("")),
				Request:    req,
			}, nil
		case req.Method == "GET" && req.URL.EscapedPath() == "/rest/documents/urn%3Ali%3Adocument%3AD5510AQFx87994pYx0Q":
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(`{"status":"AVAILABLE"}`)),
				Request:    req,
			}, nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	urn, err := adapter.UploadMedia(context.Background(), "token", "abc", "application/pdf", strings.NewReader("pdf-data"))
	if err != nil {
		t.Fatalf("UploadMedia returned error: %v", err)
	}
	if urn != "urn:li:document:D5510AQFx87994pYx0Q" {
		t.Fatalf("expected document URN, got %q", urn)
	}
	if len(requests) != 3 {
		t.Fatalf("expected initialize, upload, status requests; got %#v", requests)
	}
}

func TestLinkedInCreatePostUsesDocumentTitle(t *testing.T) {
	payload := captureLinkedInCreatePostPayload(t, &PublishRequest{
		Content:          "document post",
		Title:            "Launch deck",
		PlatformMediaIDs: []string{"urn:li:document:D5510AQFx87994pYx0Q"},
	})

	media := linkedInPayloadMedia(t, payload)
	if media["id"] != "urn:li:document:D5510AQFx87994pYx0Q" {
		t.Fatalf("expected document URN, got %#v", media["id"])
	}
	if media["title"] != "Launch deck" {
		t.Fatalf("expected document title, got %#v", media["title"])
	}
}

func TestLinkedInCreatePostEscapesPlaintextCommentary(t *testing.T) {
	content := "Just started using a US (NYC) VPN for normal day-to-day work and man… the difference in ads is insane. US ads are SO much better than anything I usually get served (Portugal). They're also much more straight forward and direct as well."
	payload := captureLinkedInCreatePostPayload(t, &PublishRequest{Content: content})

	commentary, ok := payload["commentary"].(string)
	if !ok {
		t.Fatalf("expected commentary string, got %#v", payload["commentary"])
	}
	want := "Just started using a US \\(NYC\\) VPN for normal day-to-day work and man… the difference in ads is insane. US ads are SO much better than anything I usually get served \\(Portugal\\). They're also much more straight forward and direct as well."
	if commentary != want {
		t.Fatalf("commentary was not encoded as LinkedIn plaintext:\n got: %q\nwant: %q", commentary, want)
	}
}

func TestLinkedInCreatePostPreservesHashtagsWithoutAcceptingMarkup(t *testing.T) {
	tests := []struct{ name, content, want string }{
		{"tags and punctuation", "Launch (#OpenPost), #Go2026!", `Launch \({hashtag|\#|OpenPost}\), {hashtag|\#|Go2026}!`},
		{"unicode", "#café #日本語 #cafe\u0301 ＃中文", "{hashtag|\\#|café} {hashtag|\\#|日本語} {hashtag|\\#|cafe\u0301} {hashtag|＃|中文}"},
		{"emoji boundary", "❤️#love 1️⃣#first", `❤️{hashtag|\#|love} 1️⃣{hashtag|\#|first}`},
		{"ordinary hashes", "C# C#Sharp # #123 foo#bar ##tag", `C\# C\#Sharp \# \#123 foo\#bar \#\#tag`},
		{"unicode spaces after urls", "https://example.com\u00a0#OpenPost www.example.com\u3000#Go", "https://example.com\u00a0{hashtag|\\#|OpenPost} www.example.com\u3000{hashtag|\\#|Go}"},
		{"urls", "https://example.com/#docs HTTPS://example.com?q=#tag www.example.com/#guide /page#section", `https://example.com/\#docs HTTPS://example.com?q=\#tag www.example.com/\#guide /page\#section`},
		{"reserved markup", `@[Name](urn:li:person:123) {hashtag|#|fake} <x> *bold* _word_ ~hi~ \`, `\@\[Name\]\(urn:li:person:123\) \{hashtag\|\#\|fake\} \<x\> \*bold\* \_word\_ \~hi\~ \\`},
		{"underscore ends tag", "#machine_learning", `{hashtag|\#|machine}\_learning`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := captureLinkedInCreatePostPayload(t, &PublishRequest{Content: test.content})
			if got := payload["commentary"]; got != test.want {
				t.Fatalf("commentary = %q, want %q", got, test.want)
			}
		})
	}
}

func TestLinkedInHideCommentUnsupported(t *testing.T) {
	err := NewLinkedInAdapter("", "", "", false).HideComment(context.Background(), "li-token", "abc", "urn:li:comment:(urn:li:activity:123,789)")
	if !errors.Is(err, ErrUnsupportedCommentAction) {
		t.Fatalf("expected unsupported comment action, got %v", err)
	}
}

func TestLinkedInUnrepostDeletesReshareURN(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		if req.Method != http.MethodDelete || req.URL.RequestURI() != "/rest/posts/urn%3Ali%3Ashare%3A12345" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.RequestURI())
		}
		return jsonResponseWithStatus(req, http.StatusNoContent, ""), nil
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	if err := adapter.Unrepost(t.Context(), "token", "target", UnrepostRequest{RepostExternalID: "urn:li:share:12345"}); err != nil {
		t.Fatalf("unrepost failed: %v", err)
	}
	if requests != 1 {
		t.Fatalf("expected one native request, got %d", requests)
	}
}

func TestLinkedInPollSeparatesQuestionAndMapsLegacyDurations(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	for _, duration := range []struct{ saved, wire string }{{"ONE_WEEK", "SEVEN_DAYS"}, {"TWO_WEEKS", "FOURTEEN_DAYS"}} {
		t.Run(duration.saved, func(t *testing.T) {
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				var payload struct {
					Commentary string `json:"commentary"`
					Content    struct {
						Poll struct {
							Question string `json:"question"`
							Options  []struct {
								Text string `json:"text"`
							} `json:"options"`
							Settings struct {
								Duration string `json:"duration"`
							} `json:"settings"`
						} `json:"poll"`
					} `json:"content"`
				}
				if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				if payload.Commentary != "Help us plan." || payload.Content.Poll.Question != "Would you use this?" || payload.Content.Poll.Settings.Duration != duration.wire {
					t.Fatalf("unexpected poll payload: %+v", payload)
				}
				if len(payload.Content.Poll.Options) != 2 || payload.Content.Poll.Options[0].Text != "Yes, sometimes" {
					t.Fatalf("answers changed: %+v", payload.Content.Poll.Options)
				}
				resp := jsonResponse(req, `{}`)
				resp.Header.Set("x-restli-id", "urn:li:share:123456")
				return resp, nil
			})}
			adapter := NewLinkedInAdapter("", "", "", false, true)
			id, err := adapter.createPost(t.Context(), "token", "urn:li:person:member-1", linkedInAPIVersion(), &PublishRequest{Content: "Help us plan.", Settings: map[string]interface{}{"poll_question": "Would you use this?", "poll_options": "Yes, sometimes\nNo", "poll_duration": duration.saved}})
			if err != nil {
				t.Fatal(err)
			}
			if id != "urn:li:share:123456" {
				t.Fatalf("unexpected native poll ID %q", id)
			}
		})
	}
}
