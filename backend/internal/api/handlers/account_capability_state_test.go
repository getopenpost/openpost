package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestAccountLimitProfileRequiresFreshVerifiedXSubscription(t *testing.T) {
	account := models.SocialAccount{
		Platform:            "x",
		CapabilityState:     `{"x_subscription_type":"Premium"}`,
		CapabilityCheckedAt: time.Now().UTC(),
	}
	require.Equal(t, "x-premium", accountLimitProfile(account))

	account.CapabilityCheckedAt = time.Now().UTC().Add(-accountCapabilityStateFreshness - time.Minute)
	require.Equal(t, "standard", accountLimitProfile(account))

	account.CapabilityCheckedAt = time.Now().UTC()
	account.CapabilityState = `{"x_subscription_type":"None"}`
	require.Equal(t, "standard", accountLimitProfile(account))

	account.CapabilityState = `{"x_subscription_type":"PremiumPlus"}`
	account.Platform = "mastodon"
	require.Equal(t, "standard", accountLimitProfile(account))
}

func TestStandardXPublishingCapabilitiesFailClosed(t *testing.T) {
	result := standardXPublishingCapabilities()

	require.Equal(t, platform.XStandardTextLimit, result.Constraints["text_limit"])
	require.Equal(t, platform.XStandardVideoDurationSeconds, result.Constraints["max_video_duration_seconds"])
}
