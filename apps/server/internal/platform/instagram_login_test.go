package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRegistryKeepsInstagramLoginMethodsSeparate(t *testing.T) {
	apps := []AppConfig{
		{Provider: "instagram", ClientID: "facebook-client"},
		{Provider: "instagram", ConnectionMode: "instagram_login", ClientID: "instagram-client", ClientSecret: "secret", RedirectURI: "https://app.example/api/v1/accounts/instagram/callback"},
	}
	merged := MergeAppConfigs(nil, apps...)
	require.Len(t, merged, 2, "one login method must not replace the other")
	adapters, _, err := BuildAdapterRegistry(merged, RegistryOptions{})
	require.NoError(t, err)
	legacyURL, _ := adapters["instagram"].GenerateAuthURL("state")
	directURL, _ := adapters["instagram:instagram_login"].GenerateAuthURL("state")
	require.Contains(t, legacyURL, "www.facebook.com/")
	require.Contains(t, directURL, "www.instagram.com/oauth/authorize?")
	require.Contains(t, directURL, "client_id=instagram-client")
	require.Equal(t, "instagram:instagram_login", AccountProviderKey("instagram", "", `{"connection_type":"instagram_login"}`))
	require.Equal(t, "instagram", AccountProviderKey("instagram", "", "{}"))
}

func TestInstagramLoginConnectPublishAndRefreshWithoutFacebook(t *testing.T) {
	for name, shortResponse := range map[string]string{
		"current": `{"data":[{"access_token":"short-token","user_id":"17841400000000123","permissions":"instagram_business_basic,instagram_business_content_publish"}]}`,
		"legacy":  `{"access_token":"short-token","user_id":17841400000000123}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("META_GRAPH_API_VERSION", "v25.0")
			original := httpClient
			t.Cleanup(func() { httpClient = original })
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				require.NotContains(t, req.URL.Host, "facebook")
				switch req.URL.Host + req.URL.Path {
				case "api.instagram.com/oauth/access_token":
					require.Equal(t, http.MethodPost, req.Method)
					require.Empty(t, req.URL.RawQuery)
					require.NoError(t, req.ParseForm())
					require.Equal(t, "secret", req.PostForm.Get("client_secret"))
					require.Equal(t, "authorization_code", req.PostForm.Get("grant_type"))
					return jsonResponse(req, shortResponse), nil
				case "graph.instagram.com/access_token":
					require.Equal(t, "ig_exchange_token", req.URL.Query().Get("grant_type"))
					require.Equal(t, "short-token", req.URL.Query().Get("access_token"))
					return jsonResponse(req, `{"access_token":"long-token","expires_in":5184000}`), nil
				case "graph.instagram.com/v25.0/me/permissions":
					require.Equal(t, "Bearer long-token", req.Header.Get("Authorization"))
					return jsonResponse(req, `{"data":[{"permission":"instagram_business_basic","status":"granted"},{"permission":"instagram_business_content_publish","status":"granted"},{"permission":"instagram_business_manage_comments","status":"declined"}]}`), nil
				case "graph.instagram.com/v25.0/me":
					return jsonResponse(req, `{"user_id":"17841400000000123","username":"founder","name":"Founder","account_type":"MEDIA_CREATOR","profile_picture_url":"https://cdn.example/avatar.jpg"}`), nil
				case "graph.instagram.com/v25.0/17841400000000123/media":
					require.NoError(t, req.ParseForm())
					require.Equal(t, "https://media.example/photo.jpg", req.PostForm.Get("image_url"))
					return jsonResponse(req, `{"id":"container-1"}`), nil
				case "graph.instagram.com/v25.0/container-1":
					return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
				case "graph.instagram.com/v25.0/17841400000000123/media_publish":
					return jsonResponse(req, `{"id":"published-1"}`), nil
				case "graph.instagram.com/refresh_access_token":
					require.Equal(t, "ig_refresh_token", req.URL.Query().Get("grant_type"))
					require.Equal(t, "long-token", req.URL.Query().Get("access_token"))
					return jsonResponse(req, `{"access_token":"refreshed-token","expires_in":5184000}`), nil
				default:
					t.Fatalf("unexpected provider request: %s %s", req.Method, req.URL.Path)
					return nil, nil
				}
			})}
			adapter := NewInstagramLoginAdapter("app-id", "secret", "https://app.example/callback")
			token, err := adapter.ExchangeCode(context.Background(), "code", nil)
			require.NoError(t, err)
			require.Equal(t, "instagram_business_basic instagram_business_content_publish", token.Extra["scope"], "declined permissions must not become granted scopes")
			require.Equal(t, 5184000, token.ExpiresIn)
			profile, err := adapter.GetProfile(t.Context(), token.AccessToken)
			require.NoError(t, err)
			require.Equal(t, "17841400000000123", profile.ID)
			require.Equal(t, "creator", profile.CapabilityState["instagram_account_type"])
			state, err := json.Marshal(profile.CapabilityState)
			require.NoError(t, err)
			require.Equal(t, "instagram:instagram_login", AccountProviderKey("instagram", "", string(state)))
			result, err := adapter.Publish(t.Context(), token.AccessToken, profile.ID, &PublishRequest{
				Content: "Launch", PlatformMediaIDs: []string{"https://media.example/photo.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}},
			})
			require.NoError(t, err)
			require.Equal(t, "published-1", result.ExternalID)
			require.Equal(t, RefreshCredentialAccessToken, adapter.RefreshCapability().CredentialSource)
			refreshed, err := adapter.RefreshToken(t.Context(), RefreshTokenInput{AccessToken: token.AccessToken})
			require.NoError(t, err)
			require.Equal(t, "refreshed-token", refreshed.AccessToken)
			require.Equal(t, 5184000, refreshed.ExpiresIn)
		})
	}
}
