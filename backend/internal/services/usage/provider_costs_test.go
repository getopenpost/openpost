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
