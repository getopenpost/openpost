package platform

import (
	"net/http"
	"testing"
)

func TestLinkedInCommunityManagementResolvesOrganizationLogoAsset(t *testing.T) {
	// Current Organization Lookup returns a CroppedImage containing asset URNs.
	// Its documented Images API lookup supplies the actual downloadUrl.
	for _, tt := range []struct {
		name        string
		imageStatus int
		imageBody   string
		wantAvatar  string
	}{
		{name: "available logo", imageStatus: http.StatusOK, imageBody: `{"id":"urn:li:image:C4D0BAQE6V6rj_w1yVQ","status":"AVAILABLE","downloadUrl":"https://media.licdn.com/dms/image/logo.png"}`, wantAvatar: "https://media.licdn.com/dms/image/logo.png"},
		{name: "optional logo denied", imageStatus: http.StatusForbidden, imageBody: `{"status":403,"message":"Accessing this image resource is forbidden"}`},
		{name: "unsafe download URL", imageStatus: http.StatusOK, imageBody: `{"status":"AVAILABLE","downloadUrl":"http://127.0.0.1/private"}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			adapter := communityManagementAdapter(t)
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				switch req.URL.Path {
				case "/v2/me":
					return jsonResponse(req, `{"id":"member-1","localizedFirstName":"Ada","localizedLastName":"Lovelace"}`), nil
				case "/rest/organizationAcls":
					return jsonResponse(req, `{"elements":[{"organization":"urn:li:organization:42"}],"paging":{"links":[]}}`), nil
				case "/rest/organizations/42":
					if req.URL.Query().Has("projection") {
						response := jsonResponse(req, `{"status":400,"code":"ILLEGAL_ARGUMENT","message":"projection parameter is not allowed for this endpoint"}`)
						response.StatusCode = http.StatusBadRequest
						return response, nil
					}
					return jsonResponse(req, `{"id":42,"localizedName":"OpenPost","vanityName":"openpost","logoV2":{"original":"urn:li:digitalmediaAsset:C4D0BAQE6V6rj_w1yVQ","cropped":"urn:li:digitalmediaAsset:C4D0BAQE6V6rj_w1yVQ","cropInfo":{"x":0,"y":0,"width":0,"height":0}}}`), nil
				case "/rest/images/urn:li:image:C4D0BAQE6V6rj_w1yVQ":
					if req.URL.EscapedPath() != "/rest/images/urn%3Ali%3Aimage%3AC4D0BAQE6V6rj_w1yVQ" {
						t.Fatalf("image URN must encode Rest.li path syntax: %s", req.URL.EscapedPath())
					}
					if req.Header.Get("Authorization") != "Bearer token" || req.Header.Get("Linkedin-Version") == "" || req.Header.Get("X-Restli-Protocol-Version") != "2.0.0" {
						t.Fatal("logo lookup lost required auth or API headers")
					}
					response := jsonResponse(req, tt.imageBody)
					response.StatusCode = tt.imageStatus
					return response, nil
				default:
					t.Fatalf("unexpected request %s", req.URL)
					return nil, nil
				}
			})}
			options, err := adapter.ListAccountSelections(t.Context(), &TokenResult{AccessToken: "token"})
			if err != nil || len(options) != 2 || options[1].AvatarURL != tt.wantAvatar {
				t.Fatalf("Page choice avatar incorrect: %#v %v", options, err)
			}
			profile, err := adapter.RefreshAccountMetadata(t.Context(), "token", AccountMetadataRequest{AccountID: "urn:li:organization:42"})
			if err != nil || profile.AvatarURL != tt.wantAvatar {
				t.Fatalf("Page refreshed avatar incorrect: %#v %v", profile, err)
			}
		})
	}
}
