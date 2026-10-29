package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSupportsAnalyticsLinkedInCommunityManagementParsing(t *testing.T) {
	tests := []struct {
		name     string
		capState string
		want     bool
	}{
		{"exact match", `{"linkedin_account_type":"community_management"}`, false},
		{"person type", `{"linkedin_account_type":"person"}`, true},
		{"organization type", `{"linkedin_account_type":"organization"}`, true},
		{"unrelated key with community_management value", `{"other_key":"community_management"}`, true},
		{"unrelated string containing substring", `{"note":"not_community_management_related"}`, true},
		{"similar value with suffix", `{"linkedin_account_type":"community_management_extra"}`, true},
		{"similar value with prefix", `{"linkedin_account_type":"xcommunity_management"}`, true},
		{"extra fields alongside exact match", `{"linkedin_account_type":"community_management","extra":"foo"}`, false},
		{"malformed JSON fail-safe", `not-json`, true},
		{"malformed JSON with substring fail-safe", `{"linkedin_account_type":"community_management"`, true},
		{"empty object", `{}`, true},
		{"null JSON", `null`, true},
		{"whitespace around JSON", `  {"linkedin_account_type":"community_management"}  `, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := SupportsAnalytics("linkedin", tc.capState)
			if got != tc.want {
				t.Errorf("SupportsAnalytics(linkedin,%q)=%v want %v", tc.capState, got, tc.want)
			}
		})
	}
}

// TestSupportsAnalyticsSeededDefaults pins the backfill seed for every
// provider that exists today, including providers that genuinely support
// neither feature. These seeds are existing user-visible defaults: changing
// any of them also changes seeded account_features rows.
func TestSupportsAnalyticsSeededDefaults(t *testing.T) {
	tests := []struct {
		platform string
		capState string
		want     bool
	}{
		{"x", "", true},
		{"bluesky", "", true},
		{"mastodon", "", true},
		{"pixelfed", "", true},
		{"peertube", "", true},
		{"lemmy", "", true},
		{"piefed", "", true},
		{"facebook", "", true},
		{"instagram", "", true},
		{"threads", "", true},
		{"youtube", "", true},
		{"tiktok", "", true},
		{"telegram", "", true},
		{"linkedin", "", true},
		{"linkedin", `{"linkedin_account_type":"community_management"}`, false},
		// Pinterest declares analytics in its adapter but stays behind the
		// provider readiness gate, so the seed stays false.
		{"pinterest", "", false},
		{"discord", "", false},
		{"discord", `{"connection_type":"webhook"}`, false},
		{"discord", `{"connection_type":"bot"}`, true},
		{"googlebusiness", "", false},
		{"devnull", "", true},
		{"unknown", "", false},
		{"", "", false},
	}
	for _, tc := range tests {
		if got := SupportsAnalytics(tc.platform, tc.capState); got != tc.want {
			t.Errorf("SupportsAnalytics(%q,%q)=%v want %v", tc.platform, tc.capState, got, tc.want)
		}
	}
}

func TestSupportsEngagementSeededDefaults(t *testing.T) {
	for provider, want := range map[string]bool{
		"facebook": true, "instagram": true, "linkedin": true, "threads": true,
		"mastodon": true, "pixelfed": true, "peertube": true, "lemmy": true,
		"piefed": true, "bluesky": true, "x": true, "youtube": true,
		"tiktok": false, "pinterest": false, "telegram": false,
		"discord": false, "googlebusiness": false, "devnull": false,
		"unknown": false, "": false,
	} {
		if got := SupportsEngagement(provider); got != want {
			t.Errorf("SupportsEngagement(%q)=%v want %v", provider, got, want)
		}
	}
}

// TestFeatureSupportPinterestCapabilityIsNotAvailability makes the
// capability/default distinction explicit: the Pinterest adapter declares
// analytics support, but the backfill seed stays false until the provider
// readiness gate passes. Adapter capability alone must never enable it.
func TestFeatureSupportPinterestCapabilityIsNotAvailability(t *testing.T) {
	support := NewPinterestAdapter("id", "secret", "https://app.test/callback").AnalyticsSupport()
	if !support.Account || !support.Content {
		t.Fatalf("expected the Pinterest adapter to declare analytics, got %+v", support)
	}
	if SupportsAnalytics("pinterest", "") {
		t.Fatal("Pinterest adapter capability must not enable the analytics seed")
	}
	if SupportsEngagement("pinterest") {
		t.Fatal("Pinterest must not seed engagement support")
	}
}

// TestFeatureSupportConditionalCapabilities pins the installation and account
// conditions documented in the providerFeatureSupport table: TikTok needs the
// Display API scopes and LinkedIn needs Community Management API access for
// the adapter to declare analytics, while the seeds stay unchanged because
// runtime scope checks own degraded installations. The Discord webhook adapter
// declares no analytics while the bot adapter does.
func TestFeatureSupportConditionalCapabilities(t *testing.T) {
	tiktokApp := AppConfig{Provider: "tiktok", ClientID: "conformance"}

	adapters, _, err := BuildAdapterRegistry([]AppConfig{tiktokApp}, RegistryOptions{})
	require.NoError(t, err)
	full, ok := adapters["tiktok"].(*TikTokAdapter)
	require.True(t, ok, "expected a TikTok adapter in the registry")
	if support := full.AnalyticsSupport(); !support.Account || !support.Content {
		t.Fatalf("expected full TikTok capabilities to declare analytics, got %+v", support)
	}

	adapters, _, err = BuildAdapterRegistry([]AppConfig{tiktokApp}, RegistryOptions{DisableTikTokDisplayAPI: true})
	require.NoError(t, err)
	minimal, ok := adapters["tiktok"].(*TikTokAdapter)
	require.True(t, ok, "expected a TikTok adapter in the registry")
	if support := minimal.AnalyticsSupport(); support.Account || support.Content {
		t.Fatalf("expected TikTok without Display API to declare no analytics, got %+v", support)
	}
	if !SupportsAnalytics("tiktok", "") {
		t.Fatal("TikTok seed must stay true while runtime scope checks own degraded installations")
	}

	linkedinApp := AppConfig{Provider: "linkedin", ClientID: "conformance"}
	adapters, _, err = BuildAdapterRegistry([]AppConfig{linkedinApp}, RegistryOptions{})
	require.NoError(t, err)
	linkedInDefault, ok := adapters["linkedin"].(*LinkedInAdapter)
	require.True(t, ok, "expected a LinkedIn adapter in the registry")
	if support := linkedInDefault.AnalyticsSupport(); support.Account || support.Content {
		t.Fatalf("expected default LinkedIn options to declare no analytics, got %+v", support)
	}

	adapters, _, err = BuildAdapterRegistry([]AppConfig{linkedinApp}, RegistryOptions{
		EnableLinkedInOrganizations:   true,
		EnableLinkedInMemberAnalytics: true,
	})
	require.NoError(t, err)
	linkedInFull, ok := adapters["linkedin"].(*LinkedInAdapter)
	require.True(t, ok, "expected a LinkedIn adapter in the registry")
	if support := linkedInFull.AnalyticsSupport(); !support.Account || !support.Content {
		t.Fatalf("expected LinkedIn with Community Management access to declare analytics, got %+v", support)
	}
	if !SupportsAnalytics("linkedin", "") {
		t.Fatal("LinkedIn seed must stay true for ordinary accounts")
	}
	if SupportsAnalytics("linkedin", `{"linkedin_account_type":"community_management"}`) {
		t.Fatal("LinkedIn community-management accounts must keep seeding false")
	}

	webhook, _, err := BuildAdapterRegistry([]AppConfig{
		{Provider: "discord", ConnectionMode: ConnectionModeWebhook},
	}, RegistryOptions{})
	require.NoError(t, err)
	if _, implements := webhook["discord"].(AnalyticsAdapter); implements {
		t.Fatal("expected the Discord webhook adapter to declare no analytics")
	}
	if SupportsAnalytics("discord", "") || SupportsAnalytics("discord", `{"connection_type":"webhook"}`) {
		t.Fatal("Discord webhook accounts must keep seeding false")
	}

	bot, _, err := BuildAdapterRegistry([]AppConfig{
		{Provider: "discord", ConnectionMode: ConnectionModeBot, ClientID: "conformance", ClientSecret: "conformance", BotToken: "conformance", RedirectURI: "https://app.test/callback"},
	}, RegistryOptions{})
	require.NoError(t, err)
	botAdapter, ok := bot["discord:bot"].(AnalyticsAdapter)
	require.True(t, ok, "expected a Discord bot adapter in the registry")
	if support := botAdapter.AnalyticsSupport(); !support.Account || !support.Content {
		t.Fatalf("expected the Discord bot adapter to declare analytics, got %+v", support)
	}
	if !SupportsAnalytics("discord", `{"connection_type":"bot"}`) {
		t.Fatal("Discord bot accounts must keep seeding true")
	}
}

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
