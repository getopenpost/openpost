package handlers

import (
	"context"

	"testing"

	"github.com/openpost/backend/internal/platform"

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

func TestCoordinateCapabilityRefreshReportsUnavailableIndependently(t *testing.T) {
	t.Parallel()
	result := coordinateCapabilityRefresh(t.Context(), nil, func(context.Context) (int, error) { return 1, nil })
	require.Equal(t, "unavailable", result.Engagement.Status)
	require.Equal(t, "service_unavailable", result.Engagement.ErrorCode)
	require.Equal(t, "queued", result.Messaging.Status)
}
