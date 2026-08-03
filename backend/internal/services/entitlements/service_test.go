package entitlements

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSelfHostedServiceAllowsKnownLimits(t *testing.T) {
	service := NewSelfHostedService()

	for _, limit := range []LimitKey{
		LimitWorkspaces,
		LimitSocialAccounts,
		LimitScheduledPostsMonthly,
		LimitPublishedPostsMonthly,
		LimitMediaBytesStored,
		LimitMediaBytesUploadedMonthly,
		LimitProviderWriteCallsMonthly,
		LimitTeamMembers,
	} {
		decision, err := service.Check(context.Background(), Request{
			WorkspaceID: "workspace-1",
			Limit:       limit,
			Amount:      1,
		})
		require.NoError(t, err)
		require.True(t, decision.Allowed, "limit %s should be allowed", limit)
		require.True(t, decision.Unlimited, "limit %s should be unlimited", limit)
		require.Empty(t, decision.Reason)
	}
}

func TestCloudBootstrapServiceAllowsOnlyFirstWorkspace(t *testing.T) {
	service := NewCloudBootstrapService()

	first, err := service.Check(context.Background(), Request{
		UserID:  "user-1",
		Limit:   LimitWorkspaces,
		Current: 0,
		Amount:  1,
	})
	require.NoError(t, err)
	require.True(t, first.Allowed)
	require.Equal(t, int64(1), first.Limit)

	second, err := service.Check(context.Background(), Request{
		UserID:  "user-1",
		Limit:   LimitWorkspaces,
		Current: 1,
		Amount:  1,
	})
	require.NoError(t, err)
	require.False(t, second.Allowed)
	require.Contains(t, second.Reason, "workspaces")
}

func TestCloudBootstrapServiceDeniesNonWorkspaceLimits(t *testing.T) {
	service := NewCloudBootstrapService()

	decision, err := service.Check(context.Background(), Request{
		UserID:  "user-1",
		Limit:   LimitSocialAccounts,
		Current: 0,
		Amount:  1,
	})

	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Equal(t, int64(0), decision.Limit)
}

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

func TestStaticServiceAllowsBelowLimit(t *testing.T) {
	service := NewStaticService(PlanSnapshot{
		Limits: map[LimitKey]int64{
			LimitScheduledPostsMonthly: 100,
		},
	})

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "workspace-1",
		Limit:       LimitScheduledPostsMonthly,
		Current:     40,
		Amount:      5,
	})

	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.False(t, decision.Unlimited)
	require.Equal(t, int64(100), decision.Limit)
}

func TestStaticServiceTreatsMissingLimitAsUnlimited(t *testing.T) {
	service := NewStaticService(PlanSnapshot{Limits: map[LimitKey]int64{}})

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "workspace-1",
		Limit:       LimitMediaBytesStored,
		Current:     1_000_000,
		Amount:      1_000_000,
	})

	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.True(t, decision.Unlimited)
}

func TestStaticServiceRejectsInvalidAmount(t *testing.T) {
	service := NewStaticService(PlanSnapshot{})

	decision, err := service.Check(context.Background(), Request{
		WorkspaceID: "workspace-1",
		Limit:       LimitSocialAccounts,
		Amount:      0,
	})

	require.False(t, decision.Allowed)
	require.ErrorContains(t, err, "amount must be positive")
}
