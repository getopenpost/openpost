package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesUserSessionsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'user_sessions'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "user_id TEXT NOT NULL")
	require.Contains(t, schema, "expires_at TIMESTAMP NOT NULL")
	require.Contains(t, schema, "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('user_sessions_user_id_idx', 'user_sessions_active_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}

func TestRunMigrationsUserSessionsForeignKeyCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

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
