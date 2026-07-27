package usage

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newProviderCostTestService(t *testing.T, policy ProviderCostPolicy) (*Service, *bun.DB) {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.ProviderUsageEvent)(nil),
		(*models.ProviderUsagePeriodCounter)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{
		ID:             "ws-1",
		OrganizationID: "org-1",
		Name:           "Launch",
	}).Exec(context.Background())
	require.NoError(t, err)

	service := NewService(db)
	service.SetProviderCostPolicy(policy)
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return service, db
}

func testXProviderCostPolicy(budget int64) ProviderCostPolicy {
	return NewXProviderCostPolicy(budget, 15_000, 200_000)
}

func TestRecordProviderCostIsIdempotentByOperationKey(t *testing.T) {
	service, db := newProviderCostTestService(t, testXProviderCostPolicy(1_000_000))
	ctx := context.Background()
	when := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	input := ProviderCostEventInput{
		WorkspaceID:  "ws-1",
		Provider:     ProviderX,
		Operation:    XOperationContentCreate,
		OperationKey: "job-1:attempt-0:post-1",
		Units:        1,
		OccurredAt:   when,
	}

	first, err := service.RecordProviderCost(ctx, input)
	require.NoError(t, err)
	require.True(t, first.Recorded)
	require.False(t, first.Duplicate)
	require.Equal(t, int64(15_000), first.PeriodCostMicrousd)

	second, err := service.RecordProviderCost(ctx, input)
	require.NoError(t, err)
	require.False(t, second.Recorded)
	require.True(t, second.Duplicate)
	require.Equal(t, int64(15_000), second.PeriodCostMicrousd)

	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, eventCount)
	var counter models.ProviderUsagePeriodCounter
	require.NoError(t, db.NewSelect().Model(&counter).Scan(ctx))
	require.Equal(t, int64(1), counter.EventCount)
	require.Equal(t, int64(1), counter.Units)
	require.Equal(t, int64(15_000), counter.CostMicrousd)
}

func TestRecordProviderCostRejectsOperationKeyCollision(t *testing.T) {
	service, _ := newProviderCostTestService(t, testXProviderCostPolicy(1_000_000))
	ctx := context.Background()
	when := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)

	_, err := service.RecordProviderCost(ctx, ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreate,
		OperationKey: "shared-key", Units: 1, OccurredAt: when,
	})
	require.NoError(t, err)
	_, err = service.RecordProviderCost(ctx, ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreateWithURL,
		OperationKey: "shared-key", Units: 1, OccurredAt: when,
	})
	require.ErrorContains(t, err, "reused with different event data")
}

func TestRecordProviderCostKeepsMonthBoundariesSeparate(t *testing.T) {
	service, db := newProviderCostTestService(t, testXProviderCostPolicy(1_000_000))
	ctx := context.Background()

	_, err := service.RecordProviderCost(ctx, ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreate,
		OperationKey: "july", Units: 1,
		OccurredAt: time.Date(2026, 7, 31, 23, 59, 59, 0, time.UTC),
	})
	require.NoError(t, err)
	_, err = service.RecordProviderCost(ctx, ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreate,
		OperationKey: "august", Units: 1,
		OccurredAt: time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	})
	require.NoError(t, err)

	var counters []models.ProviderUsagePeriodCounter
	require.NoError(t, db.NewSelect().Model(&counters).Order("period_start ASC").Scan(ctx))
	require.Len(t, counters, 2)
	require.Equal(t, time.July, counters[0].PeriodStart.UTC().Month())
	require.Equal(t, time.August, counters[1].PeriodStart.UTC().Month())
}

func TestRecordProviderCostEnforcesHostedBudgetWithoutPartialEvent(t *testing.T) {
	service, db := newProviderCostTestService(t, testXProviderCostPolicy(15_000))
	ctx := context.Background()
	when := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)

	_, err := service.RecordProviderCost(ctx, ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreate,
		OperationKey: "within-budget", Units: 1, OccurredAt: when,
	})
	require.NoError(t, err)
	_, err = service.RecordProviderCost(ctx, ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreate,
		OperationKey: "over-budget", Units: 1, OccurredAt: when,
	})
	require.ErrorIs(t, err, ErrProviderCostBudgetExceeded)

	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, eventCount)
}

func TestReconcileProviderCostsRebuildsCounterFromEvents(t *testing.T) {
	service, db := newProviderCostTestService(t, testXProviderCostPolicy(1_000_000))
	ctx := context.Background()
	when := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	for _, key := range []string{"one", "two"} {
		_, err := service.RecordProviderCost(ctx, ProviderCostEventInput{
			WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreate,
			OperationKey: key, Units: 1, OccurredAt: when,
		})
		require.NoError(t, err)
	}
	_, err := db.NewUpdate().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Set("event_count = 99").
		Set("units = 99").
		Set("cost_microusd = 1").
		Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, service.ReconcileProviderCosts(ctx, when))

	var counter models.ProviderUsagePeriodCounter
	require.NoError(t, db.NewSelect().Model(&counter).Scan(ctx))
	require.Equal(t, int64(2), counter.EventCount)
	require.Equal(t, int64(2), counter.Units)
	require.Equal(t, int64(30_000), counter.CostMicrousd)
}

func TestProviderCostPolicyDisabledNeverRecordsOrGatesSelfHosting(t *testing.T) {
	service, db := newProviderCostTestService(t, ProviderCostPolicy{})

	result, err := service.RecordProviderCost(context.Background(), ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreateWithURL,
		OperationKey: "selfhost", Units: 1, OccurredAt: time.Now(),
	})
	require.NoError(t, err)
	require.False(t, result.Recorded)

	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, eventCount)
}

func TestSnapshotOrganizationProviderCostsShowsSeparateBudgetAndOperations(t *testing.T) {
	service, _ := newProviderCostTestService(t, testXProviderCostPolicy(500_000))
	ctx := context.Background()
	when := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	_, err := service.RecordProviderCost(ctx, ProviderCostEventInput{
		WorkspaceID: "ws-1", Provider: ProviderX, Operation: XOperationContentCreateWithURL,
		OperationKey: "priced-url", Units: 1, OccurredAt: when,
	})
	require.NoError(t, err)

	summaries, err := service.SnapshotOrganizationProviderCosts(ctx, "org-1", when)
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	require.Equal(t, ProviderX, summaries[0].Provider)
	require.Equal(t, "USD", summaries[0].Currency)
	require.Equal(t, int64(200_000), summaries[0].CostMicrousd)
	require.Equal(t, int64(500_000), summaries[0].BudgetMicrousd)
	require.Equal(t, XPricingSourceURL, summaries[0].PricingSourceURL)
	require.Equal(t, []ProviderCostOperationSummary{{
		Operation:    XOperationContentCreateWithURL,
		EventCount:   1,
		Units:        1,
		CostMicrousd: 200_000,
	}}, summaries[0].Operations)
}
