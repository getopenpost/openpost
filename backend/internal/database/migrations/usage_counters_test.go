package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsUsageCountersCascadeWithWorkspace(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

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
