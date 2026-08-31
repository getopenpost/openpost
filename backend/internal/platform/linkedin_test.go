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

func TestLinkedInOrganizationSelectionUsesOrganizationURN(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

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
			if !strings.Contains(req.URL.Query().Get("projection"), "logoV2(original,original~:playableStreams)") {
				t.Fatalf("organization lookup omitted logo projection: %s", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"results":{"42":{"localizedName":"OpenPost","vanityName":"openpost","logoV2":{"original":"urn:li:digitalmediaAsset:logo","original~":{"elements":[{"identifiers":[{"identifier":"https://media.linkedin.example/openpost.png"}]}]}}}},"statuses":{"42":200}}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewLinkedInAdapter("", "", "", false, true)
	token := &TokenResult{AccessToken: "member-token", Extra: map[string]string{"user_id": "member-1"}}
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
	if options[1].AvatarURL != "https://media.linkedin.example/openpost.png" {
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
	if selected.AccountAvatarURL != "https://media.linkedin.example/openpost.png" {
		t.Fatalf("unexpected selected organization avatar %#v", selected)
	}
	if selected.CapabilityState["linkedin_account_type"] != "organization" {
		t.Fatalf("missing organization capability state %#v", selected.CapabilityState)
	}
}

func TestLinkedInOrganizationScopesAreExplicitlyEnabled(t *testing.T) {
	withoutOrganizations, _ := NewLinkedInAdapter("id", "secret", "https://app.example/callback", false).GenerateAuthURL("state")
	withOrganizations, _ := NewLinkedInAdapter("id", "secret", "https://app.example/callback", false, true).GenerateAuthURL("state")
	if strings.Contains(withoutOrganizations, "rw_organization_admin") {
		t.Fatalf("organization scopes must be opt-in: %s", withoutOrganizations)
	}
	parsed, err := url.Parse(withOrganizations)
	if err != nil {
		t.Fatal(err)
	}
	scope := parsed.Query().Get("scope")
	for _, required := range []string{
		"rw_organization_admin",
		"w_organization_social",
		"r_organization_social",
		"r_member_profileAnalytics",
		"r_member_postAnalytics",
	} {
		if !strings.Contains(scope, required) {
			t.Fatalf("missing scope %s from %q", required, scope)
		}
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

func TestEncodeLinkedInPlaintextEscapesEveryReservedCharacter(t *testing.T) {
	const content = `|{}@[]()<>#\*_~`
	const want = `\|\{\}\@\[\]\(\)\<\>\#\\\*\_\~`

	if got := encodeLinkedInPlaintext(content); got != want {
		t.Fatalf("unexpected LinkedIn plaintext encoding:\n got: %q\nwant: %q", got, want)
	}
}

func TestLinkedInListCommentsMapsResponse(t *testing.T) {
	t.Setenv("LINKEDIN_API_VERSION", "202606")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || req.URL.EscapedPath() != "/rest/socialActions/urn%3Ali%3Aactivity%3A123/comments" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if req.Header.Get("Authorization") != "Bearer li-token" {
			t.Fatalf("unexpected auth header %q", req.Header.Get("Authorization"))
		}
		if req.Header.Get("Linkedin-Version") != "202606" {
			t.Fatalf("unexpected linkedin version %q", req.Header.Get("Linkedin-Version"))
		}
		return jsonResponse(req, `{"elements":[{"id":"789","commentUrn":"urn:li:comment:(urn:li:activity:123,789)","actor":"urn:li:person:abc","created":{"time":1783159200000},"message":{"text":"Nice update"},"object":"urn:li:activity:123"}]}`), nil
	})}

	comments, err := NewLinkedInAdapter("", "", "", false).ListComments(context.Background(), "li-token", "abc", "urn:li:activity:123")
	if err != nil {
		t.Fatalf("ListComments returned error: %v", err)
	}
	if len(comments) != 1 {
		t.Fatalf("expected one comment, got %#v", comments)
	}
	comment := comments[0]
	if comment.ID != "urn:li:comment:(urn:li:activity:123,789)" || comment.AuthorID != "urn:li:person:abc" || comment.Text != "Nice update" || !comment.CanReply || comment.CanHide || !comment.CanDelete {
		t.Fatalf("unexpected comment mapping: %#v", comment)
	}
	if comment.CreatedAt != "2026-07-04T10:00:00Z" {
		t.Fatalf("unexpected created_at %q", comment.CreatedAt)
	}
}

func TestLinkedInReplyAndDeleteComments(t *testing.T) {
	t.Setenv("LINKEDIN_API_VERSION", "202606")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var replyPayload map[string]interface{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.Method == http.MethodPost && req.URL.EscapedPath() == "/rest/socialActions/urn%3Ali%3Acomment%3A%28urn%3Ali%3Aactivity%3A123%2C789%29/comments":
			if err := json.NewDecoder(req.Body).Decode(&replyPayload); err != nil {
				t.Fatalf("decoding reply payload: %v", err)
			}
			return jsonResponse(req, `{"id":"790","commentUrn":"urn:li:comment:(urn:li:activity:123,790)"}`), nil
		case req.Method == http.MethodDelete && req.URL.EscapedPath() == "/rest/socialActions/urn%3Ali%3Aactivity%3A123/comments/789":
			if req.URL.Query().Get("actor") != "urn:li:person:abc" {
				t.Fatalf("unexpected actor query %q", req.URL.Query().Get("actor"))
			}
			return jsonResponseWithStatus(req, http.StatusNoContent, ""), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	replyID, err := adapter.ReplyToComment(context.Background(), "li-token", "abc", "urn:li:comment:(urn:li:activity:123,789)", " Thanks ")
	if err != nil {
		t.Fatalf("ReplyToComment returned error: %v", err)
	}
	if replyID != "790" {
		t.Fatalf("expected reply ID, got %q", replyID)
	}
	if replyPayload["actor"] != "urn:li:person:abc" || replyPayload["object"] != "urn:li:activity:123" || replyPayload["parentComment"] != "urn:li:comment:(urn:li:activity:123,789)" {
		t.Fatalf("unexpected reply payload %#v", replyPayload)
	}
	message, ok := replyPayload["message"].(map[string]interface{})
	if !ok || message["text"] != "Thanks" {
		t.Fatalf("unexpected reply message %#v", replyPayload["message"])
	}
	if err := adapter.DeleteComment(context.Background(), "li-token", "abc", "urn:li:comment:(urn:li:activity:123,789)"); err != nil {
		t.Fatalf("DeleteComment returned error: %v", err)
	}
}

func TestLinkedInHideCommentUnsupported(t *testing.T) {
	err := NewLinkedInAdapter("", "", "", false).HideComment(context.Background(), "li-token", "abc", "urn:li:comment:(urn:li:activity:123,789)")
	if !errors.Is(err, ErrUnsupportedCommentAction) {
		t.Fatalf("expected unsupported comment action, got %v", err)
	}
}
