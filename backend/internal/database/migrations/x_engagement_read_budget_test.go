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

func TestXEngagementReadBudgetMigrationPersistsDurableAccountFence(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, time.September, 9, 0, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Workspace", CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "x", AccountID: "remote-account",
		Slug: "account-1", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("121_x_engagement_read_budget.sql")
	require.NoError(t, err)
	require.NoError(t, runMigrations(db, fstest.MapFS{
		"121_x_engagement_read_budget.sql": {Data: raw},
	}))

	budget := &models.XEngagementReadBudget{
		SocialAccountID: "account-1", WorkspaceID: "workspace-1", WindowStart: now,
		AttemptsUsed: 12, BlockedUntil: now.Add(time.Hour), BlockCode: "rate_limit",
		CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(budget).Exec(ctx)
	require.NoError(t, err)
	var stored models.XEngagementReadBudget
	require.NoError(t, db.NewSelect().Model(&stored).Where("social_account_id = ?", budget.SocialAccountID).Scan(ctx))
	require.Equal(t, 12, stored.AttemptsUsed)
	require.Equal(t, "rate_limit", stored.BlockCode)
}

func TestXEngagementReadBudgetMigrationIsPostgresCompatible(t *testing.T) {
	raw, err := migrationFiles.ReadFile("121_x_engagement_read_budget.sql")
	require.NoError(t, err)
	normalized := normalizeMigrationSQL(dialect.PG, string(raw))
	require.Contains(t, normalized, "attempts_used INTEGER NOT NULL DEFAULT 0")
	require.Contains(t, normalized, "blocked_until TIMESTAMP")
	require.NotContains(t, normalized, " DATETIME")
}
