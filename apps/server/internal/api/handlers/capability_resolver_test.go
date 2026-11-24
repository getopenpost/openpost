package handlers

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

type capabilityResolverTokenSource struct{}

func (capabilityResolverTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "access-token|access-secret", nil
}

type xCapabilityResolverAdapter struct {
	platform.Adapter
	result platform.AccountCapabilityResult
}

func (a xCapabilityResolverAdapter) ResolveAccountPublishingCapabilities(context.Context, string, platform.AccountCapabilityInput) (platform.AccountCapabilityResult, error) {
	return a.result, nil
}

func TestAccountCapabilityTTLAndExpiry(t *testing.T) {
	t.Parallel()
	require.Equal(t, 5*time.Minute, accountCapabilityTTL(capabilities.ProviderTikTok))
	require.Equal(t, 15*time.Minute, accountCapabilityTTL(capabilities.ProviderYouTube))
	require.Equal(t, time.Hour, accountCapabilityTTL(capabilities.ProviderMastodon))

	handler := NewCapabilityResolverHandler(nil, nil, nil, nil)
	result := platform.AccountCapabilityResult{Revision: "revision-1"}
	handler.storeAccountCapability("account|profile|direct", result, time.Now().UTC().Add(time.Minute))
	cached, _, ok := handler.cachedAccountCapability("account|profile|direct")
	require.True(t, ok)
	require.Equal(t, result.Revision, cached.Revision)

	handler.storeAccountCapability("expired", result, time.Now().UTC().Add(-time.Second))
	_, _, ok = handler.cachedAccountCapability("expired")
	require.False(t, ok)
}

func TestXAccountCapabilityResolutionFailsClosedAndUpgradesVerifiedPremium(t *testing.T) {
	t.Parallel()
	segments := []capabilities.ResolveSegment{{
		ID:   "segment-1",
		Body: strings.Repeat("x", 500),
	}}
	account := models.SocialAccount{ID: "x-account", Platform: capabilities.ProviderX}

	standard := capabilities.Resolve(capabilities.ProviderX, capabilities.ResolveInput{
		Intent:   capabilities.IntentPost,
		Segments: segments,
	})
	handler := NewCapabilityResolverHandler(nil, nil, nil, nil)
	handler.mergeAccountCapability(t.Context(), account, "", "", nil, segments, &standard)
	require.Equal(t, platform.XStandardTextLimit, standard.TextLimit)
	require.False(t, standard.Compatible)
	require.Contains(t, capabilityIssueCodes(standard.Issues), "text_too_long")

	premium := capabilities.Resolve(capabilities.ProviderX, capabilities.ResolveInput{
		Intent:   capabilities.IntentPost,
		Segments: segments,
	})
	handler = NewCapabilityResolverHandler(nil, nil, map[string]platform.Adapter{
		capabilities.ProviderX: xCapabilityResolverAdapter{
			result: platform.XPublishingCapabilities(platform.XSubscriptionTypePremium),
		},
	}, capabilityResolverTokenSource{})
	handler.mergeAccountCapability(t.Context(), account, "", "", nil, segments, &premium)
	require.Equal(t, platform.XPremiumTextLimit, premium.TextLimit)
	require.True(t, premium.Compatible)
	require.NotContains(t, capabilityIssueCodes(premium.Issues), "text_too_long")
}

func TestDynamicDiscordCapabilityKeepsSavedChannelAndCanonicalReadinessContract(t *testing.T) {
	t.Parallel()
	segments := []capabilities.ResolveSegment{{ID: "segment-1", Body: "A normal update"}}
	settings := map[string]any{"channel_id": "channel-1"}
	account := models.SocialAccount{
		ID: "discord-account", Platform: capabilities.ProviderDiscord,
		CapabilityState: `{"connection_type":"bot"}`,
	}
	resolved := capabilities.Resolve(account.Platform, capabilities.ResolveInput{
		CreationPreset: capabilities.IntentPost,
		Segments:       segments,
		Settings:       settings,
	})
	provider := xCapabilityResolverAdapter{result: platform.AccountCapabilityResult{
		Constraints: map[string]any{"text_limit": 1000},
		Options: map[string][]platform.DestinationOption{
			"discord_channels": {{Value: "channel-1", Label: "#updates"}},
		},
	}}
	handler := NewCapabilityResolverHandler(nil, nil, map[string]platform.Adapter{
		"discord:bot": provider,
	}, capabilityResolverTokenSource{})
	readiness := providerreadiness.NewService(nil, providerreadiness.ServiceOptions{})
	handler.SetProviderReadiness(readiness)
	handler.mergeAccountCapability(t.Context(), account, "en-US", "US", settings, segments, &resolved)

	require.Equal(t, 1000, resolved.TextLimit)
	require.True(t, resolved.Compatible)
	canonical, found := capabilities.FindOutput(account.Platform, resolved.OutputProfile)
	require.True(t, found)
	operation := providerreadiness.OperationPublishImmediate
	policyMode := providerreadiness.PublicationPolicyMode(account, canonical, settings)
	expected := readiness.DecideAccountPublication(
		t.Context(), account, canonical, operation, providerreadiness.ExecutionIntentProduction, policyMode,
	)
	actual := handler.publicationReadiness(t.Context(), handler.readiness, account, resolved.Capability, operation, settings)
	require.NotEmpty(t, expected.ContractDigest)
	require.Equal(t, expected.ContractDigest, actual.ContractDigest)
	require.Equal(t, expected.State, actual.State)
	require.NotContains(t, capabilityIssueCodes(resolved.Issues), "setting_required")
}

func capabilityIssueCodes(issues []capabilities.ValidationIssue) []string {
	codes := make([]string, 0, len(issues))
	for _, issue := range issues {
		codes = append(codes, issue.Code)
	}
	return codes
}

func TestCoordinateCapabilityRefreshReportsUnavailableIndependently(t *testing.T) {
	t.Parallel()
	result := coordinateCapabilityRefresh(t.Context(), nil, func(context.Context) (int, error) { return 1, nil })
	require.Equal(t, "unavailable", result.Engagement.Status)
	require.Equal(t, "service_unavailable", result.Engagement.ErrorCode)
	require.Equal(t, "queued", result.Messaging.Status)
}
