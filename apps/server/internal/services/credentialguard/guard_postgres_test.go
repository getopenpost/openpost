package credentialguard

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

func TestLockUserMutationDoesNotSerializeDifferentUsersPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(4)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	schema := fmt.Sprintf("credential_guard_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `
		CREATE TABLE "`+schema+`".users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			password_hash TEXT
		);
		INSERT INTO "`+schema+`".users (id, email) VALUES
			('user-1', 'one@example.test'),
			('user-2', 'two@example.test')
	`)
	require.NoError(t, err)

	firstLocked := make(chan struct{})
	releaseFirst := make(chan struct{})
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- db.RunInTx(context.Background(), &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, setErr := tx.ExecContext(ctx, `SET LOCAL search_path TO "`+schema+`"`); setErr != nil {
				return setErr
			}
			if _, lockErr := LockUserMutation(ctx, tx, "user-1"); lockErr != nil {
				return lockErr
			}
			close(firstLocked)
			<-releaseFirst
			return nil
		})
	}()

	select {
	case <-firstLocked:
	case err := <-firstDone:
		require.NoError(t, err)
		t.Fatal("first user lock completed before the test could hold it")
	case <-time.After(5 * time.Second):
		t.Fatal("timed out acquiring the first user lock")
	}

	secondDone := make(chan error, 1)
	go func() {
		secondDone <- db.RunInTx(context.Background(), &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, setErr := tx.ExecContext(ctx, `SET LOCAL search_path TO "`+schema+`"`); setErr != nil {
				return setErr
			}
			_, lockErr := LockUserMutation(ctx, tx, "user-2")
			return lockErr
		})
	}()

	select {
	case err := <-secondDone:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		close(releaseFirst)
		require.NoError(t, <-firstDone)
		t.Fatal("a different user's row lock was serialized behind the first user")
	}

	close(releaseFirst)
	require.NoError(t, <-firstDone)
}
