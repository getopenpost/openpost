package platform

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildAdapterRegistryAcceptsBuiltinCredentialProviders(t *testing.T) {
	// Built-in credential providers (no operator secrets) must always
	// produce template adapters so the server boots with them enabled.
	// This is the startup path that once rejected instance-less apps.
	adapters, _, err := BuildAdapterRegistry([]AppConfig{
		{Provider: providerPeerTube},
		{Provider: providerLemmy},
		{Provider: providerPieFed},
		{Provider: providerBluesky},
	}, RegistryOptions{})
	if err != nil {
		t.Fatalf("BuildAdapterRegistry returned error: %v", err)
	}
	for _, provider := range []string{providerPeerTube, providerLemmy, providerPieFed, providerBluesky} {
		if adapters[provider] == nil {
			t.Fatalf("expected template adapter for %s", provider)
		}
	}
}

func TestBuildAdapterRegistryTikTokDisplayAPIToggle(t *testing.T) {
	t.Parallel()

	app := AppConfig{Provider: "tiktok", ClientID: "tiktok-key", ClientSecret: "tiktok-secret", RedirectURI: "https://app.test/api/v1/accounts/tiktok/callback"}

	adapters, _, err := BuildAdapterRegistry([]AppConfig{app}, RegistryOptions{})
	require.NoError(t, err)
	full, ok := adapters["tiktok"].(*TikTokAdapter)
	require.True(t, ok)
	require.Equal(t, TikTokDefaultScopeCapabilities().Scopes(), full.RequestedScopes())
	require.True(t, full.AnalyticsSupport().Account)
	require.True(t, full.AnalyticsSupport().Content)

	adapters, _, err = BuildAdapterRegistry([]AppConfig{app}, RegistryOptions{DisableTikTokDisplayAPI: true})
	require.NoError(t, err)
	minimal, ok := adapters["tiktok"].(*TikTokAdapter)
	require.True(t, ok)
	require.Equal(t, TikTokRequiredPublishingScopes(), minimal.RequestedScopes())
	require.False(t, minimal.AnalyticsSupport().Account)
	require.False(t, minimal.AnalyticsSupport().Content)
	require.Contains(t, minimal.AnalyticsSupport().AccountUnavailable, "user.info.stats")
	require.Contains(t, minimal.AnalyticsSupport().ContentUnavailable, "video.list")
	authURL, _ := minimal.GenerateAuthURL("state-123")
	scope := mustParseQuery(t, authURL).Get("scope")
	require.Equal(t, "user.info.basic,video.publish,video.upload", scope)
	require.Equal(t, scope, strings.Join(minimal.RequestedScopes(), ","))
	for _, dropped := range TikTokOptionalDisplayScopes() {
		require.NotContains(t, scope, dropped)
	}
	capabilityURL, _ := minimal.GenerateAuthURLWithCapabilities("state-123", TikTokDefaultScopeCapabilities())
	capabilityScope := mustParseQuery(t, capabilityURL).Get("scope")
	for _, want := range []string{"video.publish", "user.info.stats", "video.list"} {
		require.Contains(t, capabilityScope, want)
	}
}

func TestNewInstanceAdapterCoversCredentialProviders(t *testing.T) {
	for _, provider := range []string{providerPeerTube, providerLemmy, providerPieFed} {
		adapter, ok := NewInstanceAdapter(provider, "https://instance.example")
		if !ok || adapter == nil {
			t.Fatalf("expected instance adapter for %s", provider)
		}
		if key := AccountProviderKey(provider, "https://instance.example/", ""); key != provider+":https://instance.example" {
			t.Fatalf("unexpected provider key %q", key)
		}
	}
	if _, ok := NewInstanceAdapter(providerMastodon, "https://instance.example"); ok {
		t.Fatal("mastodon must not use the stateless instance adapter path")
	}
	if _, ok := NewInstanceAdapter(providerPeerTube, ""); ok {
		t.Fatal("empty instance URL must not produce an adapter")
	}
}
