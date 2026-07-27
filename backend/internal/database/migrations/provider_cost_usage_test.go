package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesProviderCostUsageSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	for _, table := range []string{"provider_usage_events", "provider_usage_period_counters"} {
		var schema string
		require.NoError(t, db.QueryRowContext(
			ctx,
			"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
			table,
		).Scan(&schema))
		require.Contains(t, schema, "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE")
	}
}

func TestProviderCostUsageCascadesWithWorkspace(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-cost", Name: "Cost"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_usage_events (
			id, workspace_id, provider, operation, operation_key, units,
			unit_cost_microusd, cost_microusd, occurred_at
		) VALUES (
			'event-1', 'ws-cost', 'x', 'content_create', 'key-1', 1,
			15000, 15000, '2026-07-27 12:00:00+00:00'
		)
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_usage_period_counters (
			workspace_id, period_start, provider, operation, event_count, units, cost_microusd
		) VALUES (
			'ws-cost', '2026-07-01 00:00:00+00:00', 'x', 'content_create', 1, 1, 15000
		)
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM workspaces WHERE id = ?", "ws-cost")
	require.NoError(t, err)

	for _, table := range []string{"provider_usage_events", "provider_usage_period_counters"} {
		var count int
		require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr(table).Scan(ctx, &count))
		require.Zero(t, count)
	}
}
