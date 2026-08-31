package queue

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestPostgresWorkersClaimDifferentDueJobsWithoutWaiting(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	ctx := t.Context()
	adminSQL := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQL, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(ctx))

	schema := fmt.Sprintf("queue_claim_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	scopedSQL := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	scopedSQL.SetMaxOpenConns(4)
	db := bun.NewDB(scopedSQL, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(ctx))
	_, err = db.NewCreateTable().Model((*models.Job)(nil)).Exec(ctx)
	require.NoError(t, err)

	runAt := time.Now().UTC().Add(-time.Minute)
	jobs := []models.Job{
		{ID: "first", Type: jobTypeStorageDelete, Payload: `{"keys":["first"]}`, Status: jobStatusPending, RunAt: runAt, MaxAttempts: 3},
		{ID: "second", Type: jobTypeStorageDelete, Payload: `{"keys":["second"]}`, Status: jobStatusPending, RunAt: runAt, MaxAttempts: 3},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	lockTx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	locked := true
	t.Cleanup(func() {
		if !locked {
			return
		}
		require.NoError(t, lockTx.Rollback())
	})
	var lockedID string
	require.NoError(t, lockTx.NewSelect().Model((*models.Job)(nil)).
		Column("id").
		Where("id = ?", "first").
		For("UPDATE").
		Scan(ctx, &lockedID))
	require.Equal(t, "first", lockedID)

	storage := &recordingDeleteStorage{claimed: make(chan string, 1)}
	worker := NewWorker(db, "worker-1", time.Second, nil, nil, storage)
	result := make(chan bool, 1)
	go func() { result <- worker.processNextJobIfAvailable(ctx) }()

	select {
	case processed := <-result:
		require.True(t, processed)
	case <-time.After(3 * time.Second):
		require.NoError(t, lockTx.Rollback())
		locked = false
		t.Fatal("PostgreSQL worker waited on the locked oldest job instead of skipping it")
	}
	require.Equal(t, "second", <-storage.claimed)

	var first, second models.Job
	require.NoError(t, db.NewSelect().Model(&first).Where("id = ?", "first").Scan(ctx))
	require.NoError(t, db.NewSelect().Model(&second).Where("id = ?", "second").Scan(ctx))
	require.Equal(t, jobStatusPending, first.Status)
	require.Equal(t, jobStatusCompleted, second.Status)
	require.NoError(t, lockTx.Rollback())
	locked = false
}

type recordingDeleteStorage struct {
	claimed chan string
}

func (*recordingDeleteStorage) Driver() string { return "test" }

func (*recordingDeleteStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}

func (s *recordingDeleteStorage) Delete(_ context.Context, key string) error {
	s.claimed <- key
	return nil
}

func (*recordingDeleteStorage) GetURL(string) string { return "" }

func (*recordingDeleteStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(&emptyReader{}), nil
}
