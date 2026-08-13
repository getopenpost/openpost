package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestBillingRecoveryStateMigrationSQLite(t *testing.T) {
	for _, populated := range []bool{false, true} {
		populated := populated
		t.Run(migrationFixtureName(populated), func(t *testing.T) {
			sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			db := bun.NewDB(sqlDB, sqlitedialect.New())
			t.Cleanup(func() { require.NoError(t, db.Close()) })

			exerciseBillingRecoveryStateMigration(t, db, populated)
		})
	}
}

func TestBillingRecoveryStateMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	for _, populated := range []bool{false, true} {
		populated := populated
		t.Run(migrationFixtureName(populated), func(t *testing.T) {
			schema := fmt.Sprintf("billing_recovery_079_%d", time.Now().UnixNano())
			_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
			require.NoError(t, err)
			t.Cleanup(func() {
				_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
				require.NoError(t, cleanupErr)
			})
			_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
			require.NoError(t, err)

			exerciseBillingRecoveryStateMigration(t, db, populated)
		})
	}
}

func migrationFixtureName(populated bool) string {
	if populated {
		return "populated"
	}
	return "fresh"
}

func exerciseBillingRecoveryStateMigration(t *testing.T, db *bun.DB, populated bool) {
	t.Helper()
	ctx := t.Context()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL);
		CREATE TABLE billing_subscriptions (
			organization_id TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			raw_payload TEXT NOT NULL DEFAULT '{}'
		);
		CREATE TABLE billing_webhook_events (
			event_id TEXT PRIMARY KEY,
			provider TEXT NOT NULL,
			event_type TEXT NOT NULL,
			processed_at TIMESTAMP NOT NULL
		);
	`)
	require.NoError(t, err)
	if populated {
		_, err = db.ExecContext(ctx, `
			INSERT INTO billing_subscriptions (organization_id, status, raw_payload)
			VALUES ('org-1', 'past_due', '{"id":"sub-1"}');
			INSERT INTO billing_webhook_events (event_id, provider, event_type, processed_at)
			VALUES ('evt-1', 'paddle', 'subscription.past_due', CURRENT_TIMESTAMP);
		`)
		require.NoError(t, err)
	}

	raw, err := migrationFiles.ReadFile("079_billing_recovery_state.sql")
	require.NoError(t, err)
	item := migration{
		version: 79,
		name:    "079_billing_recovery_state.sql",
		sql:     normalizeMigrationSQL(db.Dialect().Name(), string(raw)),
	}
	require.NoError(t, runMigration(ctx, db, item))

	providerUpdatedAt := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	pastDueSince := providerUpdatedAt.Add(-time.Hour)
	occurredAt := providerUpdatedAt.Add(-time.Minute)
	if populated {
		_, err = db.ExecContext(ctx, `UPDATE billing_subscriptions
			SET provider_updated_at = ?, past_due_since = ?
			WHERE organization_id = 'org-1'`, providerUpdatedAt, pastDueSince)
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, `UPDATE billing_webhook_events
			SET occurred_at = ?
			WHERE event_id = 'evt-1'`, occurredAt)
		require.NoError(t, err)

		var status, rawPayload string
		var storedProviderUpdatedAt, storedPastDueSince time.Time
		require.NoError(t, db.QueryRowContext(ctx, `SELECT status, raw_payload, provider_updated_at, past_due_since
			FROM billing_subscriptions WHERE organization_id = 'org-1'`).
			Scan(&status, &rawPayload, &storedProviderUpdatedAt, &storedPastDueSince))
		require.Equal(t, "past_due", status)
		require.JSONEq(t, `{"id":"sub-1"}`, rawPayload)
		require.True(t, providerUpdatedAt.Equal(storedProviderUpdatedAt.UTC()))
		require.True(t, pastDueSince.Equal(storedPastDueSince.UTC()))

		var storedOccurredAt time.Time
		require.NoError(t, db.QueryRowContext(ctx, `SELECT occurred_at FROM billing_webhook_events WHERE event_id = 'evt-1'`).Scan(&storedOccurredAt))
		require.True(t, occurredAt.Equal(storedOccurredAt.UTC()))
	}

	var applied int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = 79`).Scan(&applied))
	require.Equal(t, 1, applied)
}
