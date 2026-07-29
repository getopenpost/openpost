package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildAdapterRegistryBuildsCanonicalAndAliasKeys(t *testing.T) {
	t.Parallel()

	adapters, entries, err := BuildAdapterRegistry([]AppConfig{
		{Provider: "bluesky"},
		{Provider: "facebook", ClientID: "facebook-client", ClientSecret: "facebook-secret", RedirectURI: "https://app.test/api/v1/accounts/facebook/callback"},
		{Provider: "instagram", ClientID: "instagram-client", ClientSecret: "instagram-secret", RedirectURI: "https://app.test/api/v1/accounts/instagram/callback"},
		{Provider: "x", ClientID: "x-client", ClientSecret: "x-secret", RedirectURI: "https://app.test/api/v1/accounts/x/callback"},
		{Provider: "tiktok", ClientID: "tiktok-client", ClientSecret: "tiktok-secret", RedirectURI: "https://app.test/api/v1/accounts/tiktok/callback"},
		{Provider: "youtube", ClientID: "youtube-client", ClientSecret: "youtube-secret", RedirectURI: "https://app.test/api/v1/accounts/youtube/callback"},
		{
			Provider:     "mastodon",
			Name:         "Personal",
			ClientID:     "masto-client",
			ClientSecret: "masto-secret",
			RedirectURI:  "urn:ietf:wg:oauth:2.0:oob",
			InstanceURL:  "https://masto.pt/",
		},
	}, RegistryOptions{})

	require.NoError(t, err)
	require.Contains(t, adapters, "bluesky")
	require.Contains(t, adapters, "facebook")
	require.Contains(t, adapters, "instagram")
	require.Contains(t, adapters, "x")
	require.Contains(t, adapters, "tiktok")
	require.Contains(t, adapters, "youtube")
	require.Contains(t, adapters, "mastodon:https://masto.pt")
	require.Contains(t, adapters, "mastodon:Personal")
	require.Same(t, adapters["mastodon:https://masto.pt"], adapters["mastodon:Personal"])
	require.Len(t, entries, 8)
}

func TestBuildAdapterRegistryRejectsUnsupportedOrIncompleteApps(t *testing.T) {
	t.Parallel()

	_, _, err := BuildAdapterRegistry([]AppConfig{{Provider: "unknown"}}, RegistryOptions{})
	require.ErrorContains(t, err, "unsupported provider app")

	_, _, err = BuildAdapterRegistry([]AppConfig{{Provider: "threads"}}, RegistryOptions{})
	require.ErrorContains(t, err, "threads provider app requires client_id")

	_, _, err = BuildAdapterRegistry([]AppConfig{{Provider: "facebook"}}, RegistryOptions{})
	require.ErrorContains(t, err, "facebook provider app requires client_id")

	_, _, err = BuildAdapterRegistry([]AppConfig{{Provider: "instagram"}}, RegistryOptions{})
	require.ErrorContains(t, err, "instagram provider app requires client_id")

	_, _, err = BuildAdapterRegistry([]AppConfig{{Provider: "tiktok"}}, RegistryOptions{})
	require.ErrorContains(t, err, "tiktok provider app requires client_id")

	_, _, err = BuildAdapterRegistry([]AppConfig{{Provider: "youtube"}}, RegistryOptions{})
	require.ErrorContains(t, err, "youtube provider app requires client_id")
}

func TestMergeAppConfigsOverridesByCanonicalProviderKey(t *testing.T) {
	t.Parallel()

	got := MergeAppConfigs([]AppConfig{
		{Provider: "bluesky"},
		{Provider: "x", ClientID: "legacy-x"},
		{Provider: "mastodon", Name: "Personal", ClientID: "legacy-masto", InstanceURL: "https://masto.pt"},
	}, AppConfig{
		Provider: " X ",
		ClientID: "cloud-x",
	}, AppConfig{
		Provider:    "mastodon",
		Name:        "Community",
		ClientID:    "cloud-masto",
		InstanceURL: "https://masto.pt/",
	}, AppConfig{
		Provider: "facebook",
		ClientID: "facebook-client",
	})

	require.Len(t, got, 4)
	require.Equal(t, "bluesky", got[0].Provider)
	require.Equal(t, "x", got[1].Provider)
	require.Equal(t, "cloud-x", got[1].ClientID)
	require.Equal(t, "mastodon", got[2].Provider)
	require.Equal(t, "Community", got[2].Name)
	require.Equal(t, "cloud-masto", got[2].ClientID)
	require.Equal(t, "https://masto.pt", got[2].InstanceURL)
	require.Equal(t, "facebook", got[3].Provider)
}

func TestIsAppProviderSupportedNormalizesProviderNames(t *testing.T) {
	t.Parallel()

	require.True(t, IsAppProviderSupported(" X "))
	require.True(t, IsAppProviderSupported("mastodon"))
	require.False(t, IsAppProviderSupported("reddit"))
}
