package usage

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func newProviderCostTestService(t *testing.T) (*Service, *bun.DB) {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
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

func xProviderCostInput(key string, at time.Time) ProviderCostEventInput {
	return ProviderCostEventInput{
		WorkspaceID:  "ws-1",
		Provider:     ProviderX,
		Operation:    XOperationPostCreate,
		OperationKey: key,
		Units:        1,
		OccurredAt:   at,
	}
}

func enableProviderCostPolicy(t *testing.T, service *Service, budget int64) {
	t.Helper()
	require.NoError(t, service.SetProviderCostPolicy(NewXProviderCostPolicy(budget, 15_000, 200_000)))
}

func TestRecordProviderCostRollsBackWhenBudgetWouldBeExceeded(t *testing.T) {
	t.Parallel()
	service, db := newProviderCostTestService(t)
	enableProviderCostPolicy(t, service, 15_000)
	at := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	_, err := service.RecordProviderCost(t.Context(), xProviderCostInput("within-budget", at))
	require.NoError(t, err)

	_, err = service.RecordProviderCost(t.Context(), xProviderCostInput("over-budget", at))

	require.ErrorIs(t, err, ErrProviderCostBudgetExceeded)
	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, eventCount)
	summary, err := service.SnapshotProviderCosts(t.Context(), "ws-1", at)
	require.NoError(t, err)
	require.Equal(t, int64(15_000), summary[0].CostMicrousd)
}
