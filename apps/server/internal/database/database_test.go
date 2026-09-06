package database

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect"
)

func TestInitDBWithDriverRejectsUnsupportedDriver(t *testing.T) {
	db, err := InitDBWithDriver("mysql", "mysql://example")
	require.Nil(t, db)
	require.ErrorContains(t, err, "unsupported database driver")
}

func TestJSONTextExprForDialect(t *testing.T) {
	require.Equal(t, "json_extract(job.payload, '$.post_id')", JSONTextExprForDialect(dialect.SQLite, "job.payload", "post_id"))
	require.Equal(t, "(job.payload::jsonb ->> 'post_id')", JSONTextExprForDialect(dialect.PG, "job.payload", "post_id"))
}

func TestDateExprForDialect(t *testing.T) {
	require.Equal(t, "DATE(p.scheduled_at)", DateExprForDialect(dialect.SQLite, "p.scheduled_at", ""))
	require.Equal(t, "DATE(datetime(p.scheduled_at, '+01:30'))", DateExprForDialect(dialect.SQLite, "p.scheduled_at", "+01:30"))
	require.Equal(t, "DATE(p.scheduled_at + (-300 * INTERVAL '1 minute'))", DateExprForDialect(dialect.PG, "p.scheduled_at", "-05:00"))
}

func TestInitDBWithDriverDoesNotExposeMalformedPostgresCredentials(t *testing.T) {
	const password = "do-not-log-this-password"
	db, err := InitDBWithDriver("postgres", "postgres://openpost:"+password+"%@localhost/openpost")
	require.Nil(t, db)
	require.Error(t, err)
	require.NotContains(t, err.Error(), password)
}

func TestPostgresPoolBudgetsFollowProcessRole(t *testing.T) {
	dsn := "postgres://openpost:secret@localhost:5432/openpost?sslmode=disable"
	expected := map[string]int{
		"all":     20,
		"web":     16,
		"worker":  8,
		"migrate": 2,
	}

	for role, maxOpen := range expected {
		t.Run(role, func(t *testing.T) {
			db, err := InitDBWithDriverAndRole("postgres", dsn, role)
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, db.Close()) })

			require.Equal(t, maxOpen, db.Stats().MaxOpenConnections)
		})
	}
}

func TestPostgresConnectionsUseUTC(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	db, err := InitDBWithDriver("postgres", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	var timezone string
	require.NoError(t, db.NewSelect().ColumnExpr("current_setting('TimeZone')").Scan(t.Context(), &timezone))
	require.Equal(t, "UTC", timezone)
}

func TestPoolObserverReportsConnectionPressureOncePerChange(t *testing.T) {
	db, err := InitDB("file::memory:?cache=shared")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	conn, err := db.Conn(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, conn.Close()) })

	waitCtx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	_, err = db.Conn(waitCtx)
	require.ErrorIs(t, err, context.DeadlineExceeded)

	var messages []string
	observer := newPoolObserver(func(format string, args ...any) {
		messages = append(messages, fmt.Sprintf(format, args...))
	})
	observer.Observe(db.Stats())
	require.Len(t, messages, 1)
	require.Contains(t, messages[0], "max_open=1")
	require.Contains(t, messages[0], "in_use=1")
	require.Contains(t, messages[0], "wait_count=1")
	require.Contains(t, messages[0], "wait_delta=1")

	observer.Observe(db.Stats())
	require.Len(t, messages, 1, "unchanged saturation must not flood logs")
}
