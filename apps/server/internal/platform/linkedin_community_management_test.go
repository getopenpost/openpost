package platform

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
)

func communityManagementAdapter(t *testing.T) *LinkedInAdapter {
	t.Helper()
	adapters, _, err := BuildAdapterRegistry([]AppConfig{{Provider: "linkedin", ClientID: "client", ClientSecret: "secret", RedirectURI: "https://app.example/callback"}}, RegistryOptions{
		LinkedInAuthMode: "community_management", EnableLinkedInOrganizations: true, EnableLinkedInMemberAnalytics: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return adapters["linkedin"].(*LinkedInAdapter)
}

func TestLinkedInCommunityManagementDiscoversPagesWithoutBatchAccess(t *testing.T) {
	adapter := communityManagementAdapter(t)
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v2/me":
			return jsonResponse(req, `{"id":"member-1","localizedFirstName":"Ada","localizedLastName":"Lovelace"}`), nil
		case "/rest/organizationAcls":
			return jsonResponse(req, `{"elements":[{"organization":"urn:li:organization:42"},{"organization":"urn:li:organization:99"}],"paging":{"links":[]}}`), nil
		case "/rest/organizations/42":
			return jsonResponse(req, `{"localizedName":"OpenPost","vanityName":"openpost"}`), nil
		case "/rest/organizations/99":
			return jsonResponse(req, `{"localizedName":"Another Page","vanityName":"another"}`), nil
		default:
			t.Fatalf("Development Tier must not require batch access: %s", req.URL)
			return nil, nil
		}
	})}
	options, err := adapter.ListAccountSelections(t.Context(), &TokenResult{AccessToken: "token"})
	if err != nil {
		t.Fatal(err)
	}
	if len(options) != 3 || options[1].ID != "organization:42" || options[1].DisplayName != "OpenPost" || options[2].ID != "organization:99" {
		t.Fatalf("unexpected account choices %#v", options)
	}
	profile, err := adapter.RefreshAccountMetadata(t.Context(), "token", AccountMetadataRequest{AccountID: "urn:li:organization:42"})
	if err != nil || profile.ID != "urn:li:organization:42" || profile.Username != "openpost" {
		t.Fatalf("Page refresh failed: %#v %v", profile, err)
	}
}

func TestLinkedInCommunityManagementPreservesPageLookupFailure(t *testing.T) {
	adapter := communityManagementAdapter(t)
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/rest/organizations/42" {
			t.Fatalf("unexpected request %s", req.URL)
		}
		response := jsonResponse(req, `{"status":403,"code":"ACCESS_DENIED"}`)
		response.StatusCode = http.StatusForbidden
		return response, nil
	})}
	_, err := adapter.RefreshAccountMetadata(t.Context(), "token", AccountMetadataRequest{AccountID: "urn:li:organization:42"})
	var providerErr *HTTPError
	if !errors.As(err, &providerErr) || providerErr.StatusCode != http.StatusForbidden || providerErr.Code != "ACCESS_DENIED" {
		t.Fatalf("Page lookup lost provider error: %v", err)
	}
}

func TestLinkedInCommunityManagementConnectsWithoutOpenIDProduct(t *testing.T) {
	adapter := communityManagementAdapter(t)
	authURL, _ := adapter.GenerateAuthURL("state")
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	want := "r_basicprofile w_member_social w_member_social_feed rw_organization_admin w_organization_social r_organization_social r_member_profileAnalytics r_member_postAnalytics"
	if got := parsed.Query().Get("scope"); got != want {
		t.Fatalf("Community Management scopes = %q, want %q", got, want)
	}

	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v2/me" || req.Header.Get("Authorization") != "Bearer token" {
			t.Fatalf("unexpected identity request %s", req.URL)
		}
		return jsonResponse(req, `{"id":"member-1","localizedFirstName":"Ada","localizedLastName":"Lovelace","vanityName":"ada-lovelace","profilePicture":{"displayImage~":{"elements":[{"identifiers":[{"identifier":"https://media.linkedin.example/ada.png"}]}]}}}`), nil
	})}
	profile, err := adapter.GetProfile(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	if profile.ID != "member-1" || profile.DisplayName != "Ada Lovelace" || profile.Username != "ada-lovelace" || profile.AvatarURL != "https://media.linkedin.example/ada.png" {
		t.Fatalf("unexpected member profile: %#v", profile)
	}
}
