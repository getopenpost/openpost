package feedback

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// TestAllowSubmissionPostgres guards the ON CONFLICT DO UPDATE rate-limit
// upsert against bun's table-alias handling. Postgres rejects an unqualified
// column reference in ON CONFLICT DO UPDATE when the target table is aliased
// (bun aliases models automatically), which surfaced as a 503 on feedback
// submission in production. The window is a full day so the test cannot race
// a window boundary while asserting the limit.
func TestAllowSubmissionPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	ctx := context.Background()
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(ctx))

	schema := fmt.Sprintf("feedback_rate_limit_%d", time.Now().UnixNano())
	_, err := db.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(ctx, `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		CREATE TABLE users (id TEXT PRIMARY KEY);
		CREATE TABLE feedback_rate_limit_windows (
			user_id TEXT NOT NULL,
			window_start TIMESTAMP NOT NULL,
			request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
			PRIMARY KEY (user_id, window_start),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO users (id) VALUES ('user-1')`)
	require.NoError(t, err)

	service := NewService(db, Config{}, nil)
	const limit = 5
	const window = 24 * time.Hour
	for attempt := 0; attempt < limit; attempt++ {
		allowed, err := service.AllowSubmission(ctx, "user-1", limit, window)
		require.NoError(t, err)
		require.True(t, allowed, "attempt %d should be allowed", attempt+1)
	}
	allowed, err := service.AllowSubmission(ctx, "user-1", limit, window)
	require.NoError(t, err)
	require.False(t, allowed, "limit must be enforced through the Postgres upsert")

	var count int
	require.NoError(t, db.NewSelect().
		Table("feedback_rate_limit_windows").
		ColumnExpr("COUNT(*)").
		Where("user_id = ?", "user-1").
		Scan(ctx, &count))
	require.Equal(t, 1, count, "rate limit must live in a single window row")
}
