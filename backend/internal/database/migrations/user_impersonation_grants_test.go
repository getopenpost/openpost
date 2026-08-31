package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsImpersonationGrantForeignKeysCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, created_at)
		VALUES ('user-2', 'target@example.com', 'hash', ?)
	`, time.Now().UTC())
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO user_impersonation_grants (
			id, token_hash, admin_user_id, target_user_id, expires_at, created_at
		) VALUES ('grant-1', 'hash', 'user-1', 'user-2', ?, ?)
	`, time.Now().UTC().Add(time.Minute), time.Now().UTC())
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", "user-2")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("user_impersonation_grants").
		Scan(ctx, &count))
	require.Equal(t, 0, count)
}
