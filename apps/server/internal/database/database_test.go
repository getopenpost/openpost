package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"
	_ "time/tzdata"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

func TestInitDBWithDriverRejectsUnsupportedDriver(t *testing.T) {
	db, err := InitDBWithDriverAndRole("mysql", "mysql://example", "all")
	require.Nil(t, db)
	require.ErrorContains(t, err, "unsupported database driver")
}

func TestJSONTextExprForDialect(t *testing.T) {
	require.Equal(t, "json_extract(job.payload, '$.post_id')", JSONTextExprForDialect(dialect.SQLite, "job.payload", "post_id"))
	require.Equal(t, "(job.payload::jsonb ->> 'post_id')", JSONTextExprForDialect(dialect.PG, "job.payload", "post_id"))
}

func TestDateExprForDialect(t *testing.T) {
	require.Equal(t, "DATE(p.scheduled_at)", dateExprForDialect(dialect.SQLite, "p.scheduled_at", ""))
	require.Equal(t, "DATE(datetime(p.scheduled_at, '+01:30'))", dateExprForDialect(dialect.SQLite, "p.scheduled_at", "+01:30"))
	require.Equal(t, "DATE(p.scheduled_at + (-300 * INTERVAL '1 minute'))", dateExprForDialect(dialect.PG, "p.scheduled_at", "-05:00"))
}

func TestInitDBWithDriverDoesNotExposeMalformedPostgresCredentials(t *testing.T) {
	const password = "do-not-log-this-password"
	db, err := InitDBWithDriverAndRole("postgres", "postgres://openpost:"+password+"%@localhost/openpost", "all")
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
	db, err := InitDBWithDriverAndRole("postgres", dsn, "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	var timezone string
	require.NoError(t, db.NewSelect().ColumnExpr("current_setting('TimeZone')").Scan(t.Context(), &timezone))
	require.Equal(t, "UTC", timezone)
}

// The SQLite driver parses stored timestamps itself. A server running outside
// UTC must still read them as UTC instants, so API JSON never carries the host
// offset. The child process owns TZ, which Go reads only at startup.
func TestSQLiteTimestampsSerializeAsUTCOutsideUTC(t *testing.T) {
	const childEnv = "OPENPOST_SQLITE_UTC_CHILD"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.CommandContext(t.Context(), os.Args[0], "-test.run=^"+t.Name()+"$", "-test.count=1", "-test.v")
		cmd.Env = append(os.Environ(), "TZ=America/New_York", childEnv+"=1")
		output, err := cmd.CombinedOutput()
		require.NoError(t, err, string(output))
		require.Contains(t, string(output), "--- PASS: "+t.Name())
		return
	}
	require.Equal(t, "America/New_York", time.Local.String())

	type sqliteUTCRow struct {
		bun.BaseModel `bun:"table:utc_timestamp_rows"`
		ID            int64     `bun:"id,pk,autoincrement" json:"-"`
		WrittenAt     time.Time `bun:"written_at,notnull" json:"written_at"`
		DefaultedAt   time.Time `bun:"defaulted_at,nullzero,notnull,default:current_timestamp" json:"defaulted_at"`
	}
	db, err := InitDBWithDriverAndRole("sqlite", "file:"+filepath.Join(t.TempDir(), "utc.db")+"?mode=rwc", "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := t.Context()
	_, err = db.NewCreateTable().Model((*sqliteUTCRow)(nil)).Exec(ctx)
	require.NoError(t, err)

	// 09:30 in New York on a winter date is 14:30 UTC.
	written := time.Date(2026, time.January, 15, 9, 30, 0, 0, time.Local)
	before := time.Now().UTC().Add(-time.Minute)
	row := &sqliteUTCRow{WrittenAt: written}
	_, err = db.NewInsert().Model(row).Exec(ctx)
	require.NoError(t, err)

	var stored sqliteUTCRow
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", row.ID).Scan(ctx))
	encoded, err := json.Marshal(stored)
	require.NoError(t, err)
	var fields map[string]string
	require.NoError(t, json.Unmarshal(encoded, &fields))
	require.Equal(t, "2026-01-15T14:30:00Z", fields["written_at"])
	defaulted, err := time.Parse(time.RFC3339, fields["defaulted_at"])
	require.NoError(t, err)
	require.Regexp(t, `Z$`, fields["defaulted_at"])
	require.WithinRange(t, defaulted, before, time.Now().UTC().Add(time.Minute))
}

func TestPoolObserverReportsConnectionPressureOncePerChange(t *testing.T) {
	db, err := InitDBWithDriverAndRole("sqlite", "file::memory:?cache=shared", "all")
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

func TestInitDBCreatesMissingSQLiteDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "db", "openpost.db")
	db, err := InitDBWithDriverAndRole("sqlite", "file:"+path+"?cache=shared&mode=rwc", "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))
	require.FileExists(t, path)
}

func TestInitDBCreatesEscapedSQLiteDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested db", "openpost.db")
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "cache=shared&mode=rwc"}).String()

	db, err := InitDBWithDriverAndRole("sqlite", dsn, "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))
	require.FileExists(t, path)
}

func TestCreateSchemaBuildsExternalApplicationIntegrationTables(t *testing.T) {
	db, err := InitDBWithDriverAndRole("sqlite", "file:"+t.Name()+"?mode=memory&cache=private", "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))

	var applied int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM schema_migrations WHERE version = 129").Scan(t.Context(), &applied))
	require.Equal(t, 1, applied)

	for _, table := range []string{
		"external_applications",
		"external_app_installations",
		"external_app_workspace_grants",
		"external_app_account_grants",
		"external_oauth_codes",
		"external_refresh_tokens",
		"external_webhook_subscriptions",
		"external_webhook_deliveries",
	} {
		var count int
		require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", table).Scan(t.Context(), &count))
		require.Equal(t, 1, count, table)
	}

	var installationColumn int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM pragma_table_info('api_tokens') WHERE name = 'installation_id'").Scan(t.Context(), &installationColumn))
	require.Equal(t, 1, installationColumn)

	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.User{ID: "operator-1", Email: "operator@example.test", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalApplication{
		ID: "application-1", ClientID: "client-1", Name: "App", ClientType: "public",
		RedirectURIsJSON: `[]`, AllowedScopes: "workspace:read", CreatedByUserID: "operator-1",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewDelete().Model((*models.User)(nil)).Where("id = ?", "operator-1").Exec(t.Context())
	require.NoError(t, err)
	var createdBy sql.NullString
	require.NoError(t, db.NewRaw("SELECT created_by_user_id FROM external_applications WHERE id = ?", "application-1").Scan(t.Context(), &createdBy))
	require.False(t, createdBy.Valid)
}

func TestConcurrentSQLiteMigrationCommandsSerializeAcrossConnections(t *testing.T) {
	t.Parallel()

	dsn := "file:" + filepath.Join(t.TempDir(), "openpost.db") + "?cache=shared&mode=rwc"
	first, err := InitDBWithDriverAndRole("sqlite", dsn, "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, first.Close()) })
	second, err := InitDBWithDriverAndRole("sqlite", dsn, "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, second.Close()) })

	start := make(chan struct{})
	var wait sync.WaitGroup
	wait.Add(2)
	errors := make(chan error, 2)
	for _, db := range []*bun.DB{first, second} {
		go func() {
			defer wait.Done()
			<-start
			errors <- CreateSchemaLocked(t.Context(), db, "sqlite", dsn)
		}()
	}
	close(start)
	wait.Wait()
	close(errors)

	for err := range errors {
		require.NoError(t, err)
	}
	require.NoError(t, RequireCurrentSchema(t.Context(), first))
}

func TestLongLivedProcessRejectsAnUnmigratedDatabase(t *testing.T) {
	t.Parallel()

	dsn := "file:" + filepath.Join(t.TempDir(), "unmigrated.db") + "?cache=shared&mode=rwc"
	db, err := InitDBWithDriverAndRole("sqlite", dsn, "all")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	err = RequireCurrentSchema(context.Background(), db)
	require.ErrorContains(t, err, "openpost migrate")

	require.NoError(t, CreateSchemaLocked(t.Context(), db, "sqlite", dsn))
	require.NoError(t, RequireCurrentSchema(context.Background(), db))
}
