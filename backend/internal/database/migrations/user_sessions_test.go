package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsUserSessionsForeignKeyCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO user_sessions (id, user_id, expires_at, created_at)
		VALUES ('session-1', 'user-1', ?, ?)
	`, time.Now().UTC().Add(time.Hour), time.Now().UTC())
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", "user-1")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("user_sessions").Scan(ctx, &count))
	require.Equal(t, 0, count)
}
