package entitlements

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStaticServiceRejectsWhenUsageWouldExceedLimit(t *testing.T) {
	service := NewStaticService(PlanSnapshot{
		Limits: map[LimitKey]int64{
			LimitSocialAccounts: 3,
		},
	})

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "workspace-1",
		Limit:       LimitSocialAccounts,
		Current:     3,
		Amount:      1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.False(t, decision.Unlimited)
	require.Equal(t, int64(3), decision.Limit)
	require.Equal(t, int64(3), decision.Current)
	require.Equal(t, int64(1), decision.Amount)
	require.Contains(t, decision.Reason, "social_accounts")
}
