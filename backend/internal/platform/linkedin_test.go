package platform

import (
	"context"
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
	profile, err := adapter.RefreshAccountMetadata(context.Background(), "member-token", AccountMetadataRequest{AccountID: "urn:li:organization:42"})
	if err != nil {
		t.Fatalf("RefreshAccountMetadata returned error: %v", err)
	}
	if profile.ID != "urn:li:organization:42" || profile.Username != "openpost" || profile.AvatarURL != "https://media.linkedin.example/openpost.png" {
		t.Fatalf("unexpected refreshed LinkedIn organization profile %#v", profile)
	}
}

func TestLinkedInAccountHistoryRejectsUncertifiedMemberIdentityWithoutAProviderCall(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		t.Fatalf("uncertified member identity reached provider: %s", req.URL)
		return nil, nil
	})}
	adapter := NewLinkedInAdapter("", "", "", false, true)
	support := adapter.AccountContentDiscoverySupport(AnalyticsAccountContext{
		AccountID: "urn:li:person:7", CapabilityState: map[string]string{"linkedin_account_type": "person"},
	})
	if support.Supported || !strings.Contains(support.UnavailableReason, "not certified") {
		t.Fatalf("member discovery must fail closed: %#v", support)
	}
	_, err := adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{
		AccountID: "urn:li:person:7", CapabilityState: map[string]string{"linkedin_account_type": "person"}, PageSize: 10,
	})
	var discoveryErr *AccountContentDiscoveryError
	if !errors.As(err, &discoveryErr) || discoveryErr.Status != AccountContentDiscoveryUnsupported {
		t.Fatalf("unexpected member discovery result: %#v, %v", discoveryErr, err)
	}
	if calls != 0 {
		t.Fatalf("expected zero provider calls, got %d", calls)
	}

	_, err = adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{
		AccountID: "urn:li:organization:42", CapabilityState: map[string]string{"linkedin_account_type": "organization"}, PageSize: 10,
	})
	if !errors.As(err, &discoveryErr) || discoveryErr.Status != AccountContentDiscoveryPermissionRequired {
		t.Fatalf("organization without certified read scope must require permission: %#v, %v", discoveryErr, err)
	}
	if calls != 0 {
		t.Fatalf("missing organization permission reached provider, calls=%d", calls)
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

func TestLinkedInHideCommentUnsupported(t *testing.T) {
	err := NewLinkedInAdapter("", "", "", false).HideComment(context.Background(), "li-token", "abc", "urn:li:comment:(urn:li:activity:123,789)")
	if !errors.Is(err, ErrUnsupportedCommentAction) {
		t.Fatalf("expected unsupported comment action, got %v", err)
	}
}

func TestLinkedInUnrepostDeletesReshareURN(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodDelete || req.URL.RequestURI() != "/rest/posts/urn%3Ali%3Ashare%3A12345" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.RequestURI())
		}
		return jsonResponseWithStatus(req, http.StatusNoContent, ""), nil
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	if err := adapter.Unrepost(t.Context(), "token", "target", UnrepostRequest{RepostExternalID: "urn:li:share:12345"}); err != nil {
		t.Fatalf("unrepost failed: %v", err)
	}
}
