package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesUsageCountersSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'usage_counters'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "PRIMARY KEY (workspace_id, metric, period_start)")
	require.Contains(t, schema, "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('usage_counters_workspace_period_idx', 'usage_counters_metric_period_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}

func TestRunMigrationsUsageCountersCascadeWithWorkspace(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-usage", Name: "Usage"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO usage_counters (workspace_id, metric, period_start, value)
		VALUES ('ws-usage', 'scheduled_posts_monthly', '2026-06-01 00:00:00+00:00', 5)
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM workspaces WHERE id = ?", "ws-usage")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("usage_counters").Scan(ctx, &count))
	require.Equal(t, 0, count)
}
