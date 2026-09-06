package handlers

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

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
