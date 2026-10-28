package mfarecovery

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

// synchronizeRecoveryCodeReadsHook holds each successful reader of the
// recovery-code table in AfterQuery until two readers have finished. bun calls
// AfterQuery after the row has been scanned, so both reads have their result in
// hand before either consumer can issue its write. The production conditional
// UPDATE never issues a SELECT and is unaffected.
type synchronizeRecoveryCodeReadsHook struct {
	mu       sync.Mutex
	arrivals int
	release  chan struct{}
}

func (*synchronizeRecoveryCodeReadsHook) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	return ctx
}

func (hook *synchronizeRecoveryCodeReadsHook) AfterQuery(ctx context.Context, event *bun.QueryEvent) {
	if event.Err != nil || event.Operation() != "SELECT" || !strings.Contains(event.Query, "user_mfa_recovery_codes") {
		return
	}

	hook.mu.Lock()
	hook.arrivals++
	if hook.arrivals == 2 {
		close(hook.release)
	}
	hook.mu.Unlock()

	select {
	case <-hook.release:
	case <-ctx.Done():
	}
}

func TestConsumeIsSingleUseAndReplacementRevokesTheOldBatch(t *testing.T) {
	t.Parallel()

	db := newRecoveryTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	now := time.Now().UTC()

	first, err := service.Generate()
	require.NoError(t, err)
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return service.ReplaceWithDB(txCtx, tx, "user-1", first, now)
	}))

	remaining, err := service.CountRemaining(ctx, "user-1")
	require.NoError(t, err)
	require.Equal(t, CodeCount, remaining)

	consumed, err := service.Consume(ctx, "user-1", first.Codes[0], now.Add(time.Second))
	require.NoError(t, err)
	require.True(t, consumed)
	consumed, err = service.Consume(ctx, "user-1", first.Codes[0], now.Add(2*time.Second))
	require.NoError(t, err)
	require.False(t, consumed)

	second, err := service.Generate()
	require.NoError(t, err)
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return service.ReplaceWithDB(txCtx, tx, "user-1", second, now.Add(3*time.Second))
	}))

	consumed, err = service.Consume(ctx, "user-1", first.Codes[1], now.Add(4*time.Second))
	require.NoError(t, err)
	require.False(t, consumed)
	consumed, err = service.Consume(ctx, "user-1", second.Codes[0], now.Add(4*time.Second))
	require.NoError(t, err)
	require.True(t, consumed)
}

func TestConcurrentConsumeAllowsExactlyOneAttempt(t *testing.T) {
	t.Parallel()

	db := newConcurrentRecoveryTestDB(t)
	// A single-connection pool serializes both attempts and hides a
	// check-then-write Consume, so this test needs real concurrent connections.
	db.SetMaxOpenConns(4)
	service := NewService(db)
	ctx := context.Background()
	now := time.Now().UTC()
	set, err := service.Generate()
	require.NoError(t, err)
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return service.ReplaceWithDB(txCtx, tx, "user-1", set, now)
	}))

	db.AddQueryHook(&synchronizeRecoveryCodeReadsHook{release: make(chan struct{})})

	start := make(chan struct{})
	results := make(chan bool, 2)
	errors := make(chan error, 2)
	consumeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for range 2 {
		go func() {
			<-start
			consumed, consumeErr := service.Consume(consumeCtx, "user-1", set.Codes[0], now.Add(time.Second))
			results <- consumed
			errors <- consumeErr
		}()
	}
	close(start)
	successes := 0
	for range 2 {
		require.NoError(t, <-errors)
		if <-results {
			successes++
		}
	}
	require.Equal(t, 1, successes)
}

func newRecoveryTestDB(t *testing.T) *bun.DB {
	t.Helper()
	return newRecoveryTestDBAt(t, fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=1", t.Name()))
}

// newConcurrentRecoveryTestDB keeps the concurrent harness on its own
// file-backed WAL database so two writers wait on the busy handler instead of
// deadlocking on one shared-cache table lock. The DSN is test-local and claims
// nothing about the production PRAGMA set.
func newConcurrentRecoveryTestDB(t *testing.T) *bun.DB {
	t.Helper()
	dsn := "file:" + filepath.Join(t.TempDir(), "mfa-recovery.db") + "?_busy_timeout=10000&_journal_mode=WAL&_foreign_keys=1"
	return newRecoveryTestDBAt(t, dsn)
}

func newRecoveryTestDBAt(t *testing.T, dsn string) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", dsn)
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()
	_, err = db.NewCreateTable().Model((*models.User)(nil)).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.UserMFARecoveryCode)(nil)).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com"}).Exec(ctx)
	require.NoError(t, err)
	return db
}
