package migrations

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestRunMigrationsCreatesCLIAuthSessionsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'cli_auth_sessions'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "device_code_hash TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "user_code_hash TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "CHECK (status IN ('pending', 'approved', 'denied', 'expired'))")
	require.Contains(t, schema, "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('cli_auth_sessions_user_id_idx', 'cli_auth_sessions_status_expires_at_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}

func TestRunMigrationsCLIAuthSessionsIdempotent(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO cli_auth_sessions (
			id, device_code_hash, user_code_hash, client_name, expires_at
		) VALUES (
			'session-1', 'device-hash-1', 'user-hash-1', 'CLI', '2030-01-01T00:00:00Z'
		)
	`)
	require.NoError(t, err)
}

func TestRunMigrationsCLIAuthSessionsUserCodeUniqueness(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, RunMigrations(db))

	insertSession(ctx, t, db, "session-1", "device-hash-1", "user-hash-1", "pending", time.Now().Add(time.Hour))
	_, err := db.ExecContext(ctx, `
		INSERT INTO cli_auth_sessions (
			id, device_code_hash, user_code_hash, client_name, status, expires_at
		) VALUES (
			'session-2', 'device-hash-2', 'user-hash-1', 'CLI', 'pending', '2030-01-01T00:00:00Z'
		)
	`)
	require.Error(t, err)
	require.Contains(t, strings.ToLower(err.Error()), "unique")
}

func TestRunMigrationsCLIAuthSessionsStatusEnum(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, RunMigrations(db))

	insertSession(ctx, t, db, "session-1", "device-hash-1", "user-hash-1", "approved", time.Now().Add(time.Hour))
	_, err := db.ExecContext(ctx, `
		INSERT INTO cli_auth_sessions (
			id, device_code_hash, user_code_hash, client_name, status, expires_at
		) VALUES (
			'session-2', 'device-hash-2', 'user-hash-2', 'CLI', 'unknown', '2030-01-01T00:00:00Z'
		)
	`)
	require.Error(t, err)
	require.Contains(t, strings.ToLower(err.Error()), "check")
}

func TestRunMigrationsCLIAuthSessionsExpiryCleanupQuery(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, RunMigrations(db))

	now := time.Now().UTC()
	insertSession(ctx, t, db, "expired-1", "device-hash-1", "user-hash-1", "pending", now.Add(-time.Hour))
	insertSession(ctx, t, db, "active-1", "device-hash-2", "user-hash-2", "pending", now.Add(time.Hour))
	insertSession(ctx, t, db, "approved-1", "device-hash-3", "user-hash-3", "approved", now.Add(-time.Hour))

	result, err := db.ExecContext(ctx, `
		UPDATE cli_auth_sessions
		SET status = 'expired'
		WHERE status = 'pending' AND expires_at <= ?
	`, now.Format(time.RFC3339))
	require.NoError(t, err)
	rows, err := result.RowsAffected()
	require.NoError(t, err)
	require.Equal(t, int64(1), rows)

	var expiredCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("cli_auth_sessions").
		Where("status = 'expired'").
		Scan(ctx, &expiredCount))
	require.Equal(t, 1, expiredCount)
}

func insertSession(ctx context.Context, t *testing.T, db *bun.DB, id, deviceHash, userHash, status string, expiresAt time.Time) {
	t.Helper()
	_, err := db.ExecContext(ctx, `
		INSERT INTO cli_auth_sessions (
			id, device_code_hash, user_code_hash, client_name, status, expires_at
		) VALUES (?, ?, ?, 'CLI', ?, ?)
	`, id, deviceHash, userHash, status, expiresAt.Format(time.RFC3339))
	require.NoError(t, err)
}
