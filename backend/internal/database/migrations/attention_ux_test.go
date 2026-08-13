package migrations

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestAttentionUXMigrationIsIdempotentAndEnforcesConstraints(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	for _, column := range []string{
		"attachments_json", "edited_at", "deleted_at", "can_like", "can_unlike", "liked",
	} {
		exists, err := migrationColumnExists(ctx, db, "engagement_items", column)
		require.NoError(t, err)
		require.True(t, exists, column)
	}
	for table := range map[string]struct{}{
		"analytics_account_snapshots":   {},
		"analytics_rendition_snapshots": {},
	} {
		exists, err := migrationColumnExists(ctx, db, table, "capture_key")
		require.NoError(t, err)
		require.True(t, exists, table)
	}

	_, err := db.ExecContext(ctx, `
		INSERT INTO feedback_rate_limit_windows (user_id, window_start, request_count)
		VALUES ('user-1', ?, 1)
	`, time.Now().UTC().Truncate(time.Minute))
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		UPDATE feedback_rate_limit_windows SET request_count = -1 WHERE user_id = 'user-1'
	`)
	require.Error(t, err)
	require.Contains(t, strings.ToLower(err.Error()), "check")

	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-attention", Name: "Attention"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-attention", WorkspaceID: "ws-attention", Platform: "x",
		AccountID: "remote-1", AccessTokenEnc: []byte("encrypted"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	for _, id := range []string{"snapshot-1", "snapshot-2"} {
		_, insertErr := db.ExecContext(ctx, `
			INSERT INTO analytics_account_snapshots
				(id, workspace_id, social_account_id, platform, metrics_json, captured_at, capture_key)
			VALUES (?, 'ws-attention', 'account-attention', 'x', '{}', ?, 'account:minute')
		`, id, time.Now().UTC())
		if id == "snapshot-1" {
			require.NoError(t, insertErr)
		} else {
			require.Error(t, insertErr)
			require.Contains(t, strings.ToLower(insertErr.Error()), "unique")
		}
	}

	_, err = db.ExecContext(ctx, "DELETE FROM users WHERE id = 'user-1'")
	require.NoError(t, err)
	var rateRows int
	require.NoError(t, db.QueryRowContext(
		ctx,
		"SELECT COUNT(*) FROM feedback_rate_limit_windows WHERE user_id = 'user-1'",
	).Scan(&rateRows))
	require.Zero(t, rateRows)
}
