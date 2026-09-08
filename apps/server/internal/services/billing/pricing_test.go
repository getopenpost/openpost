package billing

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
)

func TestHostedPurchaseChoicesMatchPublishedPackages(t *testing.T) {
	service := NewService(nil, "", PaddleConfig{
		Plans:                testCatalog(),
		PurchaseChoiceSecret: "pricing-test-signing-secret",
	})
	service.SetNowForTest(func() time.Time { return time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC) })
	for _, tc := range []struct {
		id, name               string
		monthly, annual, seats int
	}{
		{"founder", "Solo", 29, 290, 1},
		{"team", "Team", 59, 590, 5},
		{"agency", "Agency", 99, 990, 10},
	} {
		t.Run(tc.id, func(t *testing.T) {
			for period, price := range map[string]int{"monthly": tc.monthly, "annual": tc.annual} {
				choice, err := service.CreatePurchaseChoice(tc.id, period)
				require.NoError(t, err)
				require.Equal(t, tc.name, choice.PlanName)
				require.Equal(t, price, choice.ListPriceUSD)
				resolved, err := service.ResolvePurchaseChoice(choice.Token, tc.id, period)
				require.NoError(t, err)
				require.Equal(t, choice, resolved)
			}
			plan, ok := GetPlanConfig(tc.id)
			require.True(t, ok)
			access := entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: tc.id, Limits: plan.Limits})
			allowed, err := access.Check(t.Context(), entitlements.Request{Limit: entitlements.LimitTeamMembers, Current: int64(tc.seats - 1), Amount: 1})
			require.NoError(t, err)
			require.True(t, allowed.Allowed)
			denied, err := access.Check(t.Context(), entitlements.Request{Limit: entitlements.LimitTeamMembers, Current: int64(tc.seats), Amount: 1})
			require.NoError(t, err)
			require.False(t, denied.Allowed)
		})
	}
	for _, retired := range []string{"starter", "pro"} {
		_, err := service.CreatePurchaseChoice(retired, "monthly")
		require.ErrorIs(t, err, ErrPurchaseChoiceInvalid)
	}
}
