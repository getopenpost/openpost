package publisher

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
)

//nolint:unparam // workspaceID is part of the legacy write-scope signature; tests pass a static workspace while canonical callers use publicationWriteScope.
func legacyWriteScope(
	ctx context.Context,
	workspaceID, socialAccountID, targetKey, subject string,
) providerWriteScope {
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	owner := execution.ID
	if owner == "" {
		owner = workspaceID
	}
	return providerWriteScope{
		operationID:     strings.Join([]string{"legacy", owner, subject, "publish"}, ":"),
		socialAccountID: socialAccountID,
		targetKey:       targetKey,
		operation:       "publish",
	}
}

type delayedQuota struct{ entitlements.Service }

func (s delayedQuota) Check(ctx context.Context, r entitlements.Request) (entitlements.Decision, error) {
	d, e := s.Service.Check(ctx, r)
	time.Sleep(30 * time.Millisecond)
	return d, e
}
func TestConcurrentProviderDispatchRespectsMonthlyQuota(t *testing.T) {
	for _, metric := range []entitlements.LimitKey{entitlements.LimitProviderWriteCallsMonthly, entitlements.LimitPublishedPostsMonthly} {
		t.Run(string(metric), func(t *testing.T) {
			srv := newPublisherUsageTestServer(t, &fakePublisherAdapter{})
			srv.service.SetEntitlement(delayedQuota{entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "limited", Limits: map[entitlements.LimitKey]int64{metric: 1}})})
			_, err := srv.db.NewCreateTable().Model((*models.MonthlyUsageReservation)(nil)).Exec(t.Context())
			require.NoError(t, err)
			// Limited dispatch uses the same Organization mutation fence as other quotas.
			_, err = srv.db.NewCreateTable().Model((*models.Organization)(nil)).IfNotExists().Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.Organization{ID: "org", Name: "org"}).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("organization_id = ?", "org").Where("id = ?", "ws-1").Exec(t.Context())
			require.NoError(t, err)
			var wg sync.WaitGroup
			results := make(chan error, 2)
			start := make(chan struct{})
			adapters := []*fakePublisherAdapter{{}, {}}
			for i, adapter := range adapters {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					scope := legacyWriteScope(t.Context(), "ws-1", "account-1", "x", string(rune('a'+i)))
					_, err := srv.service.publishProviderWithUsage(t.Context(), "ws-1", "x", "subject", "publish", scope, adapter, "token", "x-account", &platform.PublishRequest{Content: "hello", Profile: models.ContentProfileShortText, OutputProfile: "x.post"}, nil)
					results <- err
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			success, denied := 0, 0
			for err := range results {
				if err == nil {
					success++
				} else {
					require.ErrorIs(t, err, usage.ErrQuotaExceeded)
					denied++
				}
			}
			require.Equal(t, 1, success)
			require.Equal(t, 1, denied)
			current, err := srv.usage.CurrentMonthly(t.Context(), "ws-1", metric, time.Now())
			require.NoError(t, err)
			require.Equal(t, int64(1), current)
			require.Equal(t, 1, adapters[0].publishCalls+adapters[1].publishCalls)
		})
	}
}

func TestPublishedQuotaKeepsOperationIdentityAcrossRecovery(t *testing.T) {
	for _, outcome := range []string{"accepted", "ambiguous", "before-send"} {
		t.Run(outcome, func(t *testing.T) {
			adapter := &fakePublisherAdapter{}
			if outcome == "ambiguous" {
				adapter.publishErr = errors.New("connection lost after sending")
			}
			if outcome == "before-send" {
				adapter.preFenceErrors = []error{errors.New("credentials expired before send")}
			}
			srv := newPublisherUsageTestServer(t, adapter)
			for _, model := range []any{(*models.Organization)(nil), (*models.MonthlyUsageReservation)(nil)} {
				_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
				require.NoError(t, err)
			}
			_, err := srv.db.NewInsert().Model(&models.Organization{ID: "org", Name: "org"}).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("organization_id = ?", "org").Where("id = ?", "ws-1").Exec(t.Context())
			require.NoError(t, err)
			srv.service.SetEntitlement(entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "limited", Limits: map[entitlements.LimitKey]int64{entitlements.LimitPublishedPostsMonthly: 1}}))
			scope := legacyWriteScope(t.Context(), "ws-1", "account-1", "x", "first")
			publish := func(scope providerWriteScope) error {
				_, err := srv.service.publishProviderWithUsage(t.Context(), "ws-1", "x", "subject", "publish", scope, adapter, "token", "x-account", &platform.PublishRequest{Content: "hello", Profile: models.ContentProfileShortText, OutputProfile: "x.post"}, nil)
				return err
			}
			firstErr := publish(scope)
			if outcome == "accepted" {
				require.NoError(t, firstErr)
			} else {
				require.Error(t, firstErr)
			}
			if outcome == "before-send" {
				current, err := srv.usage.CurrentMonthly(t.Context(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now())
				require.NoError(t, err)
				require.Zero(t, current, "a definite failure before sending releases the held publication slot")
			}
			// A new service instance reads the same durable operation receipt.
			srv.service = NewService(srv.db, nil)
			srv.service.SetUsage(srv.usage)
			srv.service.SetEntitlement(entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "limited", Limits: map[entitlements.LimitKey]int64{entitlements.LimitPublishedPostsMonthly: 1}}))
			enableSelfHostedPublisherReadiness(t, srv.db, srv.service, "x", "account-1")
			retryErr := publish(scope)
			if outcome == "ambiguous" {
				require.Error(t, retryErr)
				require.Equal(t, 1, adapter.publishCalls)
			} else {
				require.NoError(t, retryErr)
				expected := 1
				if outcome == "before-send" {
					expected = 2
				}
				require.Equal(t, expected, adapter.publishCalls)
			}
			count, err := srv.usage.CurrentMonthly(t.Context(), "ws-1", entitlements.LimitPublishedPostsMonthly, time.Now())
			require.NoError(t, err)
			require.Equal(t, int64(1), count)
			require.Error(t, publish(legacyWriteScope(t.Context(), "ws-1", "account-1", "x", "other")))
		})
	}
}

type observedQuota struct {
	entitlements.Service
	beforeCheck func(context.Context)
}

func (s observedQuota) Check(ctx context.Context, request entitlements.Request) (entitlements.Decision, error) {
	s.beforeCheck(ctx)
	return s.Service.Check(ctx, request)
}

func TestQuotaDenialReleasesUnsentProviderCost(t *testing.T) {
	adapter := &fakePublisherAdapter{}
	srv := newPublisherUsageTestServer(t, adapter)
	_, err := srv.db.NewCreateTable().Model((*models.Organization)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Organization{ID: "org", Name: "org"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("organization_id = ?", "org").Where("id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)
	observed := false
	reservationKey := ""
	srv.service.SetEntitlement(observedQuota{
		Service: entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "limited", Limits: map[entitlements.LimitKey]int64{entitlements.LimitProviderWriteCallsMonthly: 0}}),
		beforeCheck: func(ctx context.Context) {
			if observed {
				return
			}
			var reservation models.ProviderUsageReservation
			require.NoError(t, srv.db.NewSelect().Model(&reservation).Where("workspace_id = ?", "ws-1").Scan(ctx))
			require.Equal(t, "x", reservation.Provider)
			require.Equal(t, "pending", reservation.State)
			require.Equal(t, int64(15000), reservation.CostMicrousd)
			reservationKey = reservation.OperationKey
			require.NotEmpty(t, reservationKey)
			observed = true
		},
	})
	require.NoError(t, srv.usage.SetProviderCostPolicy(usage.NewXProviderCostPolicy(1000000, 15000, 200000)))
	scope := legacyWriteScope(t.Context(), "ws-1", "account-1", "x", "denied")
	_, err = srv.service.publishProviderWithUsage(t.Context(), "ws-1", "x", "denied", "publish", scope, adapter, "token", "x-account", &platform.PublishRequest{Content: "hello", Profile: models.ContentProfileShortText, OutputProfile: "x.post"}, nil)
	require.ErrorIs(t, err, usage.ErrQuotaExceeded)
	require.True(t, observed)
	reservations, queryErr := srv.db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Where("operation_key = ?", reservationKey).Count(t.Context())
	require.NoError(t, queryErr)
	require.Zero(t, reservations)
	require.Zero(t, adapter.publishCalls)
	costs, err := srv.usage.SnapshotProviderCosts(t.Context(), "ws-1", time.Now())
	require.NoError(t, err)
	require.Len(t, costs, 1)
	for _, cost := range costs {
		require.Zero(t, cost.ReservedMicrousd)
		require.Zero(t, cost.CostMicrousd)
	}
}
