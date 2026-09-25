package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
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

	account.CapabilityCheckedAt = time.Now().UTC().Add(10 * time.Minute)
	require.Equal(t, "standard", accountLimitProfile(account))

	account.CapabilityCheckedAt = time.Now().UTC()
	account.CapabilityState = `{"x_subscription_type":"None"}`
	require.Equal(t, "standard", accountLimitProfile(account))

	account.CapabilityState = `{"x_subscription_type":"PremiumPlus"}`
	account.Platform = "mastodon"
	require.Empty(t, accountLimitProfile(account))
}
