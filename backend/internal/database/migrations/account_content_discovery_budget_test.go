package migrations

import (
	"context"
	"testing"
	"testing/fstest"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect"
)

func TestAccountContentDiscoveryBudgetMigrationPersistsDurableCounters(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE account_content_discovery_states (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			social_account_id TEXT NOT NULL UNIQUE,
			platform TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'partial',
			coverage_status TEXT NOT NULL DEFAULT 'partial',
			coverage_description TEXT NOT NULL DEFAULT '',
			cursor TEXT NOT NULL DEFAULT '',
			backfill_watermark TIMESTAMP,
			last_attempted_at TIMESTAMP,
			last_success_at TIMESTAMP,
			failure_code TEXT NOT NULL DEFAULT '',
			failure_message TEXT NOT NULL DEFAULT '',
			next_eligible_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`)
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("119_account_content_discovery_budget.sql")
	require.NoError(t, err)
	require.NoError(t, runMigrations(db, fstest.MapFS{
		"119_account_content_discovery_budget.sql": {Data: raw},
	}))

	now := time.Date(2026, time.September, 3, 0, 0, 0, 0, time.UTC)
	state := &models.AccountContentDiscoveryState{
		ID: "state-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1", Platform: "youtube",
		Status: "partial", CoverageStatus: "partial", CyclePublishedAfter: now.Add(-90 * 24 * time.Hour),
		InitialItemsDiscovered: 100, ReadBudgetWindowStart: now, ReadBudgetUsed: 7,
	}
	_, err = db.NewInsert().Model(state).Exec(ctx)
	require.NoError(t, err)
	var stored models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", state.ID).Scan(ctx))
	require.Equal(t, 100, stored.InitialItemsDiscovered)
	require.Equal(t, 7, stored.ReadBudgetUsed)
}

func TestAccountContentDiscoveryBudgetMigrationIsPostgresCompatible(t *testing.T) {
	raw, err := migrationFiles.ReadFile("119_account_content_discovery_budget.sql")
	require.NoError(t, err)
	normalized := normalizeMigrationSQL(dialect.PG, string(raw))
	require.Contains(t, normalized, "cycle_published_after TIMESTAMP")
	require.Contains(t, normalized, "read_budget_used INTEGER NOT NULL DEFAULT 0")
	require.NotContains(t, normalized, " DATETIME")
}
