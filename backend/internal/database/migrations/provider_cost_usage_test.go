package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestProviderCostUsageCascadesWithWorkspace(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-cost", Name: "Cost"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_usage_events (
			id, workspace_id, provider, operation, operation_key, units,
			unit_cost_microusd, cost_microusd, occurred_at
		) VALUES ('event-1', 'ws-cost', 'x', 'post_create', 'key-1', 1, 15000, 15000, CURRENT_TIMESTAMP)
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_usage_period_counters (
			workspace_id, period_start, provider, operation, event_count, units, cost_microusd
		) VALUES ('ws-cost', '2026-07-01 00:00:00+00:00', 'x', 'post_create', 1, 1, 15000)
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_usage_reservations (
			operation_key, workspace_id, provider, operation, state, units,
			unit_cost_microusd, cost_microusd, occurred_at
		) VALUES ('reservation-1', 'ws-cost', 'x', 'post_create', 'unknown', 1, 15000, 15000, CURRENT_TIMESTAMP)
	`)
	require.NoError(t, err)

	_, err = db.NewDelete().Model((*models.Workspace)(nil)).Where("id = ?", "ws-cost").Exec(ctx)
	require.NoError(t, err)

	eventCount, err := db.NewSelect().Model((*models.ProviderUsageEvent)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 0, eventCount)
	counterCount, err := db.NewSelect().Model((*models.ProviderUsagePeriodCounter)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 0, counterCount)
	reservationCount, err := db.NewSelect().Model((*models.ProviderUsageReservation)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 0, reservationCount)
}
