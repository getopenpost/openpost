package posts

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestValidateStoredXMediaLimitsUsesFreshSubscriptionState(t *testing.T) {
	now := time.Now().UTC()
	account := models.SocialAccount{
		Platform:            "x",
		CapabilityState:     `{"x_subscription_type":"Premium"}`,
		CapabilityCheckedAt: now,
	}
	media := []platform.MediaItem{{
		MimeType:   "video/mp4",
		Size:       int64(platform.XStandardVideoSizeBytes) + 1,
		DurationMS: int64(platform.XStandardVideoDurationSeconds+1) * 1000,
	}}

	require.NoError(t, validateStoredXMediaLimits(account, media, now))

	account.CapabilityCheckedAt = now.Add(-platform.XCapabilityStateFreshness - time.Minute)
	require.ErrorContains(t, validateStoredXMediaLimits(account, media, now), "512 MiB")
}

func TestValidateStoredXMediaLimitsRejectsPremiumOversizeVideo(t *testing.T) {
	now := time.Now().UTC()
	account := models.SocialAccount{
		Platform:            "x",
		CapabilityState:     `{"x_subscription_type":"PremiumPlus"}`,
		CapabilityCheckedAt: now,
	}
	media := []platform.MediaItem{{
		MimeType: "video/mp4",
		Size:     platform.XPremiumVideoSizeBytes + 1,
	}}

	require.ErrorContains(t, validateStoredXMediaLimits(account, media, now), "16 GiB")
}

func TestStoredAccountTextLimitFailsClosedWhenXStateIsStale(t *testing.T) {
	now := time.Now().UTC()
	account := models.SocialAccount{
		Platform:            "x",
		CapabilityState:     `{"x_subscription_type":"Basic"}`,
		CapabilityCheckedAt: now,
	}

	limit, ok := storedAccountTextLimit(account, now)
	require.True(t, ok)
	require.Equal(t, platform.XPremiumTextLimit, limit)

	account.CapabilityCheckedAt = now.Add(-platform.XCapabilityStateFreshness - time.Minute)
	limit, ok = storedAccountTextLimit(account, now)
	require.True(t, ok)
	require.Equal(t, platform.XStandardTextLimit, limit)
}
