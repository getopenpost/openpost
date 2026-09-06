package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

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

func TestBuildAdapterRegistryAcceptsCompleteContractOnlyApps(t *testing.T) {
	t.Parallel()

	adapters, entries, err := BuildAdapterRegistry([]AppConfig{
		{Provider: "pinterest", ClientID: "pin-client", ClientSecret: "pin-secret", RedirectURI: "https://app.test/api/v1/accounts/pinterest/callback"},
		{Provider: "telegram", BotToken: "telegram-token", BotUsername: "@openpost_test_bot", WebhookSecret: "telegram-webhook-secret"},
		{Provider: "discord", ConnectionMode: "webhook"},
		{Provider: "discord", ConnectionMode: "bot", ClientID: "discord-app", ClientSecret: "discord-client-secret", BotToken: "discord-bot-token", RedirectURI: "https://app.test/api/v1/accounts/discord/callback"},
	}, RegistryOptions{})

	require.NoError(t, err)
	require.Contains(t, adapters, "pinterest")
	require.Contains(t, adapters, "discord")
	require.Contains(t, adapters, "discord:webhook")
	require.Contains(t, adapters, "discord:bot")
	require.IsType(t, &DiscordAdapter{}, adapters["discord:webhook"])
	require.IsType(t, &DiscordBotAdapter{}, adapters["discord:bot"])
	require.Len(t, entries, 4)
	require.Equal(t, ConnectionModeOAuth, entries[0].ConnectionMode)
	require.Equal(t, providerPinterest, entries[0].Provider)
	require.Equal(t, ConnectionModeWebhook, entries[1].ConnectionMode)
	require.Equal(t, ConnectionModeWebhook, entries[2].ConnectionMode)
	require.Equal(t, ConnectionModeBot, entries[3].ConnectionMode)
}

func TestValidateAppConfigFailsClosedForHostedAndSelfHostedBotShapes(t *testing.T) {
	t.Parallel()

	complete := []AppConfig{
		{Provider: "pinterest", ClientID: "hosted-client", ClientSecret: "hosted-secret", RedirectURI: "https://app.test/api/v1/accounts/pinterest/callback"},
		{Provider: "telegram", BotToken: "selfhost-token", BotUsername: "openpost_bot", WebhookSecret: "selfhost-webhook-secret"},
		{Provider: "discord", ConnectionMode: "bot", ClientID: "discord-app", ClientSecret: "discord-secret", BotToken: "discord-token", RedirectURI: "https://selfhost.test/api/v1/accounts/discord/callback"},
	}
	for _, app := range complete {
		require.NoError(t, ValidateAppConfig(app), app.Provider)
	}

	incomplete := []AppConfig{
		{Provider: "pinterest", ClientID: "pin-client"},
		{Provider: "telegram", BotToken: "telegram-token", BotUsername: "openpost_bot"},
		{Provider: "discord", ConnectionMode: "bot", ClientID: "discord-app", ClientSecret: "discord-secret", RedirectURI: "https://selfhost.test/callback"},
	}
	for _, app := range incomplete {
		require.Error(t, ValidateAppConfig(app), app.Provider)
	}
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
