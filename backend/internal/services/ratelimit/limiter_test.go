package ratelimit

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCleanupRetainsIdleBucketUntilItsLimitWindowEnds(t *testing.T) {
	now := time.Now().UTC()
	limiter := New()
	limiter.lastCleanup = now.Add(-cleanupInterval)
	limiter.buckets["workspace-invite"] = &bucket{
		windowStart: now.Add(-11 * time.Minute),
		window:      time.Hour,
		count:       5,
		lastSeen:    now.Add(-11 * time.Minute),
	}

	require.False(t, limiter.Allow("workspace-invite", 5, time.Hour))
}
