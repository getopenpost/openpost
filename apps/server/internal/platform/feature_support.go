package platform

import (
	"encoding/json"
	"strings"
)

// providerFeatureSupport is the single declarative owner for the
// provider-to-feature support decision consumed by the account-feature
// backfill. SupportsAnalytics and SupportsEngagement both read this table,
// and the conformance test in feature_support_test.go verifies it against the
// adapters built by BuildAdapterRegistry, so adding a provider without
// updating the table fails a test instead of silently seeding the wrong
// default.
//
// Analytics keeps two columns because adapter capability and the seeded
// default are not the same thing:
//
//   - adapterAnalytics records what the registered adapter declares through
//     AnalyticsSupport under full installation capabilities (TikTok with the
//     Display API scopes, LinkedIn with Community Management API access).
//   - seedAnalytics records the backfill default after public readiness gates.
//     Pinterest declares analytics in its adapter, but its capabilities stay
//     behind provider access and certification (RequiresAppReview in the
//     capabilities catalogue), so its seed stays false. The runtime
//     accountfeatures.supportFor check remains the authority for availability;
//     adapter capability alone must never enable a provider.
//
// Engagement keeps one column: every adapter that declares engagement support
// is also seeded with it, and the conformance test enforces both directions.
type providerFeatureSupport struct {
	adapterAnalytics bool
	seedAnalytics    bool
	engagement       bool
}

var providerFeatureTable = map[string]providerFeatureSupport{
	providerX:         {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerBluesky:   {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerMastodon:  {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerPixelfed:  {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerPeerTube:  {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerLemmy:     {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerPieFed:    {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerFacebook:  {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerInstagram: {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerThreads:   {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	providerYouTube:   {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	// TikTok analytics need the Display API scopes (see TikTokAdapter
	// AnalyticsSupport and TikTokScopeCapabilities). The seed stays true
	// because runtime scope checks correct degraded installations.
	providerTikTok: {adapterAnalytics: true, seedAnalytics: true},
	// LinkedIn analytics need Community Management API access for the
	// installation (see LinkedInAdapter AnalyticsSupport). A per-account
	// community-management capability state still seeds false below, and
	// AnalyticsSupportForAccount owns per-account scoping at runtime.
	providerLinkedIn: {adapterAnalytics: true, seedAnalytics: true, engagement: true},
	// Telegram has no Adapter in the registry (its application contract is not
	// adapter-backed), so the conformance test cannot verify it. The seeded
	// default is preserved as-is; runtime availability stays owned by
	// accountfeatures.supportFor.
	providerTelegram: {seedAnalytics: true},
	// The plain discord row covers webhook and legacy accounts. Bot accounts
	// resolve to discord:bot below.
	providerDiscord: {adapterAnalytics: false, seedAnalytics: false, engagement: false},
	// Discord bot analytics come from the DiscordBotAdapter; the webhook
	// adapter declares none. Neither mode declares engagement support.
	providerDiscord + ":" + ConnectionModeBot: {adapterAnalytics: true, seedAnalytics: true, engagement: false},
	// Pinterest declares analytics in its adapter, but public availability
	// stays behind provider access and certification. Keep the seed false and
	// let the runtime readiness gates decide; see the type comment.
	providerPinterest: {adapterAnalytics: true, seedAnalytics: false, engagement: false},
	// The GoogleBusiness adapter does not implement AnalyticsAdapter (only the
	// package-level GoogleBusinessAnalyticsSupport describes the reporting
	// boundary) and declares no engagement support.
	providerGoogleBusiness: {adapterAnalytics: false, seedAnalytics: false, engagement: false},
	providerDevNull:        {adapterAnalytics: true, seedAnalytics: true, engagement: false},
}

// lookupFeatureSupport resolves one table row for a provider account. Unknown
// providers return the zero row (no support), matching the old switch default.
func lookupFeatureSupport(provider, capabilityState string) providerFeatureSupport {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == providerDiscord {
		key := AccountProviderKey(provider, "", capabilityState)
		if key == providerDiscord+":"+ConnectionModeWebhook {
			key = providerDiscord
		}
		if row, ok := providerFeatureTable[key]; ok {
			return row
		}
		return providerFeatureSupport{}
	}
	if row, ok := providerFeatureTable[provider]; ok {
		return row
	}
	return providerFeatureSupport{}
}

// SupportsAnalytics reports the seeded analytics default for the given
// platform. It is the canonical source for migration backfill; runtime
// availability is owned by accountfeatures.supportFor, which applies scope,
// plan, and provider-approval gating on top of the stored preference.
func SupportsAnalytics(platformName string, capabilityState string) bool {
	if strings.ToLower(strings.TrimSpace(platformName)) == providerLinkedIn && isLinkedInCommunityManagementState(capabilityState) {
		return false
	}
	return lookupFeatureSupport(platformName, capabilityState).seedAnalytics
}

// SupportsEngagement reports whether the given platform has an engagement adapter
// that is enabled. Canonical for migration backfill.
func SupportsEngagement(platformName string) bool {
	return lookupFeatureSupport(platformName, "").engagement
}

func isLinkedInCommunityManagementState(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	var state map[string]string
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return false
	}
	return state["linkedin_account_type"] == "community_management"
}
