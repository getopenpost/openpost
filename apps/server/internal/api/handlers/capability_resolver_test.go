package handlers

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync/atomic"
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

func TestDynamicCapabilityFailureOnlyBlocksRequiredActiveChoice(t *testing.T) {
	t.Parallel()
	resolved := capabilities.ResolvedCapability{
		Compatible: true,
		Capability: capabilities.Capability{
			Provider: capabilities.ProviderTikTok,
			Settings: []capabilities.SettingDefinition{{
				Key:           "privacy_level",
				Label:         "Privacy",
				Required:      true,
				OptionsSource: "tiktok_privacy_levels",
				Dependencies: []capabilities.SettingCondition{{
					Key:      "content_posting_method",
					Operator: "equals",
					Value:    "DIRECT_POST",
				}},
			}},
		},
	}
	handler := NewCapabilityResolverHandler(nil, nil, nil, nil)

	upload := resolved
	handler.addDynamicCapabilityFailure(&upload, map[string]any{"content_posting_method": "UPLOAD"}, "creator state unavailable")
	require.True(t, upload.Compatible)
	require.Equal(t, "warning", upload.Issues[0].Severity)
	require.Equal(t, "dynamic_options_unavailable", upload.Issues[0].Code)

	direct := resolved
	handler.addDynamicCapabilityFailure(&direct, map[string]any{"content_posting_method": "DIRECT_POST"}, "creator state unavailable")
	require.False(t, direct.Compatible)
	require.Equal(t, "error", direct.Issues[0].Severity)
	require.Equal(t, "required_dynamic_options_unavailable", direct.Issues[0].Code)

	cacheUpload := accountCapabilitySettingsKey(map[string]any{"content_posting_method": "UPLOAD", "community_id": "one"})
	require.Equal(t, cacheUpload, accountCapabilitySettingsKey(map[string]any{"community_id": "one", "content_posting_method": "UPLOAD"}))
	require.NotEqual(t, cacheUpload, accountCapabilitySettingsKey(map[string]any{"content_posting_method": "UPLOAD", "community_id": "two"}))
	require.NotEqual(t, cacheUpload, accountCapabilitySettingsKey(map[string]any{"content_posting_method": "DIRECT_POST", "community_id": "one"}))
}

func TestAccountCapabilityTenantKeyTracksIdentityOnly(t *testing.T) {
	t.Parallel()
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: capabilities.ProviderX,
		OAuthGrantID: "grant-1", GrantedScopes: "tweet.read", InstanceURL: "",
	}
	key := accountCapabilityTenantKey(account)
	withState := account
	withState.CapabilityState = `{"subscription_type":"premium"}`
	require.Equal(t, key, accountCapabilityTenantKey(withState), "persisting state must not invalidate the entry")

	reconnected := account
	reconnected.OAuthGrantID = "grant-2"
	require.NotEqual(t, key, accountCapabilityTenantKey(reconnected))
	scoped := account
	scoped.GrantedScopes = "tweet.read users.read"
	require.NotEqual(t, key, accountCapabilityTenantKey(scoped))
	moved := account
	moved.InstanceURL = "https://social.example"
	require.NotEqual(t, key, accountCapabilityTenantKey(moved))

	discord := models.SocialAccount{
		ID: "discord-1", WorkspaceID: "workspace-1", Platform: capabilities.ProviderDiscord,
	}
	bot := discord
	bot.CapabilityState = `{"connection_type":"bot"}`
	webhook := discord
	webhook.CapabilityState = `{"connection_type":"webhook"}`
	require.NotEqual(t, accountCapabilityTenantKey(bot), accountCapabilityTenantKey(webhook))
}

func TestAccountCapabilityCacheEvictsOldestEntry(t *testing.T) {
	t.Parallel()
	handler := NewCapabilityResolverHandler(nil, nil, nil, nil)
	result := platform.AccountCapabilityResult{Revision: "revision-1"}
	now := time.Now().UTC()
	handler.storeAccountCapability("oldest", result, now.Add(time.Hour))
	// Tight-loop inserts can share a timestamp, which makes victim selection
	// fall back to map order. Pin "oldest" deterministically instead.
	oldest := handler.cache["oldest"]
	oldest.storedAt = now.Add(-time.Minute)
	handler.cache["oldest"] = oldest
	for index := 0; index < accountCapabilityCacheLimit-1; index++ {
		handler.storeAccountCapability(
			"account-"+strconv.Itoa(index),
			result,
			now.Add(time.Hour),
		)
	}
	handler.storeAccountCapability("new", result, now.Add(time.Hour))

	require.LessOrEqual(t, len(handler.cache), accountCapabilityCacheLimit)
	_, _, ok := handler.cachedAccountCapability("oldest")
	require.False(t, ok, "the oldest entry is evicted first")
	_, _, ok = handler.cachedAccountCapability("new")
	require.True(t, ok)
}

func TestCapabilityCacheWriteFailureKeepsVerifiedDestinationCompatible(t *testing.T) {
	t.Parallel()
	// Removing the table makes persisting capability state fail.
	db := createHandlerTestDB(t, (*models.SocialAccount)(nil))
	_, err := db.ExecContext(t.Context(), "DROP TABLE social_accounts")
	require.NoError(t, err)
	handler := NewCapabilityResolverHandler(db, nil, map[string]platform.Adapter{
		capabilities.ProviderX: &keyedCapabilityAdapter{
			result: platform.AccountCapabilityResult{
				State: map[string]string{"subscription_type": "premium"},
			},
		},
	}, capabilityResolverTokenSource{})
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: capabilities.ProviderX,
	}
	segments := []capabilities.ResolveSegment{{ID: "segment-1", Body: "A normal update"}}
	resolved := capabilities.Resolve(capabilities.ProviderX, capabilities.ResolveInput{Segments: segments})

	handler.mergeAccountCapability(t.Context(), account, "en-US", "US", nil, segments, &resolved)

	require.True(t, resolved.Compatible)
	codes := capabilityIssueCodes(resolved.Issues)
	require.Contains(t, codes, "account_capability_cache_failed")
	for _, issue := range resolved.Issues {
		if issue.Code == "account_capability_cache_failed" {
			require.Equal(t, "warning", issue.Severity)
		}
	}
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

func TestAccountLimitProfileRequiresFreshVerifiedXSubscription(t *testing.T) {
	t.Parallel()
	account := models.SocialAccount{
		Platform:            "x",
		CapabilityState:     `{"x_subscription_type":"Premium"}`,
		CapabilityCheckedAt: time.Now().UTC(),
	}
	require.Equal(t, "x-premium", accountLimitProfile(account))

	account.CapabilityCheckedAt = time.Now().UTC().Add(-accountCapabilityStateFreshness - time.Minute)
	require.Equal(t, "standard", accountLimitProfile(account))

	account.CapabilityCheckedAt = time.Now().UTC().Add(10 * time.Minute)
	require.Equal(t, "standard", accountLimitProfile(account))

	account.CapabilityCheckedAt = time.Now().UTC()
	account.CapabilityState = `{"x_subscription_type":"None"}`
	require.Equal(t, "standard", accountLimitProfile(account))

	account.CapabilityState = `{"x_subscription_type":"PremiumPlus"}`
	account.Platform = "mastodon"
	require.Empty(t, accountLimitProfile(account))
}

func TestCoordinateCapabilityRefreshIsolatesFailureAndStartsBothCapabilities(t *testing.T) {
	t.Parallel()
	var engagementStarted atomic.Bool
	var messagingStarted atomic.Bool
	release := make(chan struct{})

	resultChannel := make(chan RefreshCapabilitiesResult, 1)
	go func() {
		resultChannel <- coordinateCapabilityRefresh(t.Context(), func(context.Context) (int, error) {
			engagementStarted.Store(true)
			<-release
			return 0, errors.New("provider discovery failed")
		}, func(context.Context) (int, error) {
			messagingStarted.Store(true)
			return 3, nil
		})
	}()

	require.Eventually(t, func() bool {
		return engagementStarted.Load() && messagingStarted.Load()
	}, time.Second, time.Millisecond)
	close(release)
	result := <-resultChannel
	require.Equal(t, RefreshCapabilityOutcome{Status: "failed", ErrorCode: "refresh_failed"}, result.Engagement)
	require.Equal(t, RefreshCapabilityOutcome{Status: "queued", Queued: 3}, result.Messaging)
}

func TestCoordinateCapabilityRefreshReportsUnavailableIndependently(t *testing.T) {
	t.Parallel()
	result := coordinateCapabilityRefresh(t.Context(), nil, func(context.Context) (int, error) { return 1, nil })
	require.Equal(t, "unavailable", result.Engagement.Status)
	require.Equal(t, "service_unavailable", result.Engagement.ErrorCode)
	require.Equal(t, "queued", result.Messaging.Status)
}
