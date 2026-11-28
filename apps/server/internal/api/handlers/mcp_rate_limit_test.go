package handlers

import (
	"testing"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/stretchr/testify/require"
)

func TestMCPPerTokenRateLimitingEnforcesMinuteAndHourBudgets(t *testing.T) {
	handler := NewMCPHandler(nil, nil)
	handler.SetRateLimiter(ratelimit.New(), 2, 3)

	tokenA := &middleware.Principal{UserID: "user-1", TokenID: "tok-a"}
	tokenB := &middleware.Principal{UserID: "user-1", TokenID: "tok-b"}

	require.Nil(t, handler.checkToolRateLimit(tokenA))
	require.Nil(t, handler.checkToolRateLimit(tokenA))
	limited := handler.checkToolRateLimit(tokenA)
	require.NotNil(t, limited)
	require.Equal(t, -32000, limited.Code)
	require.Contains(t, limited.Message, "per-minute")

	// A separate token for the same user keeps its own budget.
	require.Nil(t, handler.checkToolRateLimit(tokenB))

	// Hourly cap triggers independently when minute cap is higher.
	handler.SetRateLimiter(ratelimit.New(), 10, 2)
	require.Nil(t, handler.checkToolRateLimit(tokenA))
	require.Nil(t, handler.checkToolRateLimit(tokenA))
	hourly := handler.checkToolRateLimit(tokenA)
	require.NotNil(t, hourly)
	require.Equal(t, -32000, hourly.Code)
	require.Contains(t, hourly.Message, "hourly")
}
