package platform

import (
	"net/http"

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
