package usage

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newProviderCostTestService(t *testing.T) (*Service, *bun.DB) {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.ProviderUsageEvent)(nil),
		(*models.ProviderUsageReservation)(nil),
		(*models.ProviderUsagePeriodCounter)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Organization{
		ID:   "org-1",
		Name: "Organization",
	}).Exec(t.Context())
	require.NoError(t, err)
	for _, workspace := range []models.Workspace{
		{ID: "ws-1", OrganizationID: "org-1", Name: "One"},
		{ID: "ws-2", OrganizationID: "org-1", Name: "Two"},
	} {
		_, err = db.NewInsert().Model(&workspace).Exec(t.Context())
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return NewService(db), db
}

func xProviderCostInput(key, operation string, at time.Time) ProviderCostEventInput {
	return ProviderCostEventInput{
		WorkspaceID:  "ws-1",
		Provider:     ProviderX,
		Operation:    operation,
		OperationKey: key,
		Units:        1,
		OccurredAt:   at,
	}
}

func enableProviderCostPolicy(t *testing.T, service *Service, budget int64) {
	t.Helper()
	require.NoError(t, service.SetProviderCostPolicy(NewXProviderCostPolicy(budget, 15_000, 200_000)))
}

func TestRecordProviderCostIsIdempotent(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 500_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	input := xProviderCostInput("request-1", XOperationPostCreate, at)

	first, err := service.RecordProviderCost(t.Context(), input)
	require.NoError(t, err)
	second, err := service.RecordProviderCost(t.Context(), input)
	require.NoError(t, err)

	require.True(t, first.Enabled)
	require.True(t, first.Recorded)
	require.Equal(t, int64(15_000), first.PeriodCostMicrousd)
	require.True(t, second.Enabled)
	require.False(t, second.Recorded)
	require.Equal(t, int64(15_000), second.CostMicrousd)

	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, eventCount)
	counterCount, err := db.NewSelect().Model((*models.ProviderUsagePeriodCounter)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, counterCount)
}

func TestProviderCostReservationIsNotBillableUntilConfirmed(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 500_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	input := xProviderCostInput("reserved-request", XOperationPostCreate, at)

	reserved, err := service.ReserveProviderCost(t.Context(), input)

	require.NoError(t, err)
	require.True(t, reserved.Enabled)
	require.True(t, reserved.Reserved)
	require.Equal(t, int64(15_000), reserved.PeriodExposureMicrousd)
	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, eventCount)
	summary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", at)
	require.NoError(t, err)
	require.Equal(t, int64(0), summary[0].CostMicrousd)
	require.Equal(t, int64(1), summary[0].ReservedEventCount)
	require.Equal(t, int64(15_000), summary[0].ReservedMicrousd)

	confirmed, err := service.ConfirmProviderCost(t.Context(), input.OperationKey)

	require.NoError(t, err)
	require.True(t, confirmed.Recorded)
	require.Equal(t, int64(15_000), confirmed.PeriodCostMicrousd)
	reservationCount, err := db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, reservationCount)
	summary, err = service.SnapshotProviderCosts(t.Context(), "ws-1", at)
	require.NoError(t, err)
	require.Equal(t, int64(15_000), summary[0].CostMicrousd)
	require.Equal(t, int64(0), summary[0].ReservedMicrousd)
}

func TestProviderCostDefiniteFailureReleasesReservation(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 15_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	input := xProviderCostInput("failed-request", XOperationPostCreate, at)
	_, err := service.ReserveProviderCost(t.Context(), input)
	require.NoError(t, err)

	require.NoError(t, service.ReleaseProviderCost(t.Context(), input.OperationKey))
	require.NoError(t, service.ReleaseProviderCost(t.Context(), input.OperationKey))

	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, eventCount)
	reservationCount, err := db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, reservationCount)
	summary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", at)
	require.NoError(t, err)
	require.Equal(t, int64(0), summary[0].CostMicrousd)
	require.Equal(t, int64(0), summary[0].ReservedMicrousd)

	_, err = service.ReserveProviderCost(
		t.Context(),
		xProviderCostInput("replacement-request", XOperationPostCreate, at),
	)
	require.NoError(t, err)
}

func TestProviderCostUnknownOutcomeRemainsReservedButNotBillable(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 15_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	input := xProviderCostInput("unknown-request", XOperationPostCreate, at)
	_, err := service.ReserveProviderCost(t.Context(), input)
	require.NoError(t, err)

	require.NoError(t, service.MarkProviderCostUnknown(t.Context(), input.OperationKey))

	var reservation models.ProviderUsageReservation
	require.NoError(t, db.NewSelect().Model(&reservation).Where("operation_key = ?", input.OperationKey).Scan(t.Context()))
	require.Equal(t, providerCostReservationUnknown, reservation.State)
	summary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", at)
	require.NoError(t, err)
	require.Equal(t, int64(0), summary[0].CostMicrousd)
	require.Equal(t, int64(15_000), summary[0].ReservedMicrousd)

	_, err = service.ReserveProviderCost(
		t.Context(),
		xProviderCostInput("blocked-by-unknown", XOperationPostCreate, at),
	)
	require.ErrorIs(t, err, ErrProviderCostBudgetExceeded)
}

func TestRecordProviderCostRejectsOperationKeyCollision(t *testing.T) {
	t.Parallel()
	service, _ := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 500_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	_, err := service.RecordProviderCost(t.Context(), xProviderCostInput("same-key", XOperationPostCreate, at))
	require.NoError(t, err)

	_, err = service.RecordProviderCost(t.Context(), xProviderCostInput("same-key", XOperationPostCreateWithURL, at))

	require.ErrorContains(t, err, "operation key collision")
}

func TestRecordProviderCostRollsBackWhenBudgetWouldBeExceeded(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 15_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	_, err := service.RecordProviderCost(t.Context(), xProviderCostInput("within-budget", XOperationPostCreate, at))
	require.NoError(t, err)

	_, err = service.RecordProviderCost(t.Context(), xProviderCostInput("over-budget", XOperationPostCreate, at))

	require.ErrorIs(t, err, ErrProviderCostBudgetExceeded)
	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, eventCount)
	summary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", at)
	require.NoError(t, err)
	require.Equal(t, int64(15_000), summary[0].CostMicrousd)
}

func TestProviderCostPeriodsUseUTCMonthBoundaries(t *testing.T) {
	t.Parallel()
	service, _ := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 500_000)
	july := time.Date(2026, time.July, 31, 23, 59, 59, 0, time.UTC)
	august := july.Add(time.Second)
	_, err := service.RecordProviderCost(t.Context(), xProviderCostInput("july", XOperationPostCreate, july))
	require.NoError(t, err)
	_, err = service.RecordProviderCost(t.Context(), xProviderCostInput("august", XOperationPostCreate, august))
	require.NoError(t, err)

	julySummary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", july)
	require.NoError(t, err)
	augustSummary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", august)
	require.NoError(t, err)

	require.Equal(t, int64(15_000), julySummary[0].CostMicrousd)
	require.Equal(t, "2026-07-01T00:00:00Z", julySummary[0].PeriodStart)
	require.Equal(t, int64(15_000), augustSummary[0].CostMicrousd)
	require.Equal(t, "2026-08-01T00:00:00Z", augustSummary[0].PeriodStart)
}

func TestReconcileProviderCostsRebuildsPeriodCounters(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 500_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	_, err := service.RecordProviderCost(t.Context(), xProviderCostInput("plain", XOperationPostCreate, at))
	require.NoError(t, err)
	_, err = service.RecordProviderCost(t.Context(), xProviderCostInput("link", XOperationPostCreateWithURL, at))
	require.NoError(t, err)
	_, err = service.ReserveProviderCost(t.Context(), xProviderCostInput("unknown", XOperationPostCreate, at))
	require.NoError(t, err)
	require.NoError(t, service.MarkProviderCostUnknown(t.Context(), "unknown"))
	_, err = db.NewUpdate().
		Model((*models.ProviderUsagePeriodCounter)(nil)).
		Set("event_count = 999, units = 999, cost_microusd = 999").
		Set("reserved_event_count = 999, reserved_units = 999, reserved_cost_microusd = 999").
		Where("period_start = ?", MonthStart(at)).
		Exec(t.Context())
	require.NoError(t, err)

	require.NoError(t, service.ReconcileProviderCosts(t.Context(), at))

	summary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", at)
	require.NoError(t, err)
	require.Len(t, summary, 1)
	require.Equal(t, int64(2), summary[0].EventCount)
	require.Equal(t, int64(215_000), summary[0].CostMicrousd)
	require.Equal(t, int64(1), summary[0].ReservedEventCount)
	require.Equal(t, int64(15_000), summary[0].ReservedMicrousd)
	require.Len(t, summary[0].Operations, 2)
}

func TestProviderCostPolicyDisabledDoesNotGateSelfHostedRequests(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	result, err := service.RecordProviderCost(t.Context(), xProviderCostInput(
		"selfhost",
		XOperationPostCreate,
		time.Now().UTC(),
	))

	require.NoError(t, err)
	require.False(t, result.Enabled)
	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, eventCount)
	reservationCount, err := db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, reservationCount)
}

func TestOrganizationProviderCostSnapshotCombinesWorkspaceBudgets(t *testing.T) {
	t.Parallel()
	service, _ := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 500_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	_, err := service.RecordProviderCost(t.Context(), xProviderCostInput("ws-1", XOperationPostCreate, at))
	require.NoError(t, err)
	input := xProviderCostInput("ws-2", XOperationPostCreate, at)
	input.WorkspaceID = "ws-2"
	_, err = service.RecordProviderCost(t.Context(), input)
	require.NoError(t, err)

	summary, err := service.SnapshotOrganizationProviderCosts(t.Context(), "org-1", at)

	require.NoError(t, err)
	require.Len(t, summary, 1)
	require.Equal(t, int64(30_000), summary[0].CostMicrousd)
	require.Equal(t, int64(1_000_000), summary[0].BudgetMicrousd)
}

func TestPruneProviderUsageEventsIsBounded(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 500_000)
	old := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	for _, key := range []string{"old-1", "old-2"} {
		_, err := service.RecordProviderCost(t.Context(), xProviderCostInput(key, XOperationPostCreate, old))
		require.NoError(t, err)
	}
	_, err := service.ReserveProviderCost(t.Context(), xProviderCostInput("old-unknown", XOperationPostCreate, old))
	require.NoError(t, err)
	require.NoError(t, service.MarkProviderCostUnknown(t.Context(), "old-unknown"))

	pruned, err := service.PruneProviderUsageEvents(t.Context(), old.AddDate(0, 1, 0), 1)

	require.NoError(t, err)
	require.Equal(t, int64(1), pruned)
	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, eventCount)
	reservationsPruned, err := service.PruneProviderUsageReservations(t.Context(), old.AddDate(0, 1, 0), 1)
	require.NoError(t, err)
	require.Equal(t, int64(1), reservationsPruned)
	reservationCount, err := db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, reservationCount)
	_, err = service.PruneProviderUsageEvents(t.Context(), old, 0)
	require.Error(t, err)
	_, err = service.PruneProviderUsageReservations(t.Context(), old, 0)
	require.Error(t, err)
}
