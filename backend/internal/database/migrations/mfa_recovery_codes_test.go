package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesMFARecoveryCodesWithCascadeAndActiveUniqueness(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	now := time.Now().UTC()
	_, err := db.ExecContext(ctx, `
		INSERT INTO user_mfa_recovery_codes (id, user_id, batch_id, code_hash, created_at)
		VALUES ('code-1', 'user-1', 'batch-1', 'hash-1', ?)
	`, now)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO user_mfa_recovery_codes (id, user_id, batch_id, code_hash, created_at)
		VALUES ('code-2', 'user-1', 'batch-2', 'hash-1', ?)
	`, now)
	require.Error(t, err)

	_, err = db.ExecContext(ctx, "UPDATE user_mfa_recovery_codes SET used_at = ? WHERE id = 'code-1'", now)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO user_mfa_recovery_codes (id, user_id, batch_id, code_hash, created_at)
		VALUES ('code-2', 'user-1', 'batch-2', 'hash-1', ?)
	`, now)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM users WHERE id = 'user-1'")
	require.NoError(t, err)
	var remaining int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("user_mfa_recovery_codes").Scan(ctx, &remaining))
	require.Zero(t, remaining)
}
