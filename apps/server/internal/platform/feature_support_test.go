package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// conformanceTableKey maps a built registry entry back to its
// providerFeatureTable row. Instance-scoped entries (Mastodon, Pixelfed,
// PeerTube, Lemmy, PieFed, Bluesky PDS) share their provider row, and both
// Instagram connection modes share the instagram row.
func conformanceTableKey(entry RegistryEntry) string {
	if entry.Provider == providerDiscord && entry.ConnectionMode == ConnectionModeBot {
		return providerDiscord + ":" + ConnectionModeBot
	}
	return entry.Provider
}

// conformanceApps builds one complete app per registered adapter builder so
// the conformance test sees every provider in appBuilders. Both Discord modes
// and both Instagram modes are covered because they build different adapters.
func conformanceApps() []AppConfig {
	complete := AppConfig{
		Name: "conformance", ClientID: "conformance", ClientSecret: "conformance",
		RedirectURI: "https://app.test/callback", InstanceURL: "https://instance.example",
		BotToken: "conformance", BotUsername: "conformance", WebhookSecret: "conformance",
	}
	apps := make([]AppConfig, 0, len(appBuilders)+2)
	for provider := range appBuilders {
		switch provider {
		case providerDiscord:
			apps = append(apps,
				AppConfig{Provider: provider, ConnectionMode: ConnectionModeWebhook},
				AppConfig{Provider: provider, ConnectionMode: ConnectionModeBot, ClientID: "conformance", ClientSecret: "conformance", BotToken: "conformance", RedirectURI: "https://app.test/callback"},
			)
		case providerInstagram:
			instagram := complete
			instagram.Provider = provider
			login := instagram
			login.ConnectionMode = ConnectionModeInstagramLogin
			apps = append(apps, instagram, login)
		default:
			app := complete
			app.Provider = provider
			apps = append(apps, app)
		}
	}
	return apps
}

// TestFeatureSupportTableCoversRegisteredAdapters is the tripwire: it
// enumerates every adapter built by BuildAdapterRegistry and fails when a
// registered adapter declares analytics or engagement support that the
// providerFeatureTable omits, or when the table claims support no adapter
// declares. Adding a provider to appBuilders without updating the table fails
// here instead of silently seeding the wrong backfill default.
func TestFeatureSupportTableCoversRegisteredAdapters(t *testing.T) {
	t.Parallel()
	// Full installation capabilities: TikTok keeps the Display API scopes and
	// LinkedIn keeps Community Management API access, matching the
	// adapterAnalytics column documented in providerFeatureTable.
	_, entries, err := BuildAdapterRegistry(conformanceApps(), RegistryOptions{EnableLinkedInOrganizations: true,
		EnableLinkedInMemberAnalytics: true,
	})
	require.NoError(t, err)
	require.NotEmpty(t, entries)

	seen := make(map[string]bool)
	built := make(map[string]bool)
	for _, entry := range entries {
		key := conformanceTableKey(entry)
		built[key] = true
		row, ok := providerFeatureTable[key]
		if !ok {
			t.Errorf("registered adapter %q (provider %q mode %q) has no providerFeatureTable entry", entry.Key, entry.Provider, entry.ConnectionMode)
			continue
		}
		seen[key] = true
		var declaredAnalytics, declaredEngagement bool
		if analytics, implements := entry.Adapter.(AnalyticsAdapter); implements {
			support := analytics.AnalyticsSupport()
			declaredAnalytics = support.Account || support.Content
		}
		if engagement, implements := entry.Adapter.(EngagementAdapter); implements {
			declaredEngagement = engagement.EngagementSupport().Enabled
		}
		if declaredAnalytics != row.adapterAnalytics {
			t.Errorf("provider %q adapter declares analytics=%v but table records adapterAnalytics=%v", key, declaredAnalytics, row.adapterAnalytics)
		}
		if declaredEngagement != row.engagement {
			t.Errorf("provider %q adapter declares engagement=%v but table records engagement=%v", key, declaredEngagement, row.engagement)
		}
	}

	for provider := range appBuilders {
		if !built[provider] {
			t.Errorf("appBuilders provider %q produced no registry entry; the conformance apps may be incomplete", provider)
		}
	}
	if !built[providerDiscord+":"+ConnectionModeBot] {
		t.Error("expected a discord:bot registry entry to cover the bot table row")
	}
	for key, row := range providerFeatureTable {
		if (row.adapterAnalytics || row.engagement) && !seen[key] {
			t.Errorf("providerFeatureTable[%q] claims adapter support but no registry adapter covers it", key)
		}
	}

	// Telegram is the documented carve-out: its application contract is not
	// adapter-backed, so a complete Telegram app must yield no registry
	// entries while keeping its seeded default.
	_, telegramEntries, err := BuildAdapterRegistry([]AppConfig{
		{Provider: providerTelegram, BotToken: "conformance", BotUsername: "conformance", WebhookSecret: "conformance"},
	}, RegistryOptions{})
	require.NoError(t, err)
	if len(telegramEntries) != 0 {
		t.Errorf("expected no registry entries for telegram, got %d", len(telegramEntries))
	}
	if !SupportsAnalytics("telegram", "") {
		t.Error("telegram seed must stay true even though no adapter declares it")
	}
}
