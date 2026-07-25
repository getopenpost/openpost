package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestAccountCapabilityTTLAndExpiry(t *testing.T) {
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

	require.Equal(t, "upload", accountCapabilitySettingsKey(map[string]any{"content_posting_method": "UPLOAD"}))
	require.Equal(t, "direct", accountCapabilitySettingsKey(map[string]any{"content_posting_method": "DIRECT_POST"}))
}
