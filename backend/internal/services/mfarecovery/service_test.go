package mfarecovery

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestGenerateReturnsUniqueTranscriptionSafeCodesAndOnlyHashesPersist(t *testing.T) {
	t.Parallel()

	service := NewService(nil)
	set, err := service.Generate()
	require.NoError(t, err)
	require.Len(t, set.Codes, CodeCount)
	require.Len(t, set.Hashes, CodeCount)
	require.Len(t, set.BatchID, 36)

	codes := make(map[string]struct{}, CodeCount)
	hashes := make(map[string]struct{}, CodeCount)
	for index, code := range set.Codes {
		require.Regexp(t, `^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}){3}$`, code)
		_, duplicate := codes[code]
		require.False(t, duplicate)
		codes[code] = struct{}{}
		require.NotContains(t, set.Hashes[index], code)
		require.Equal(t, 64, len(set.Hashes[index]))
		_, duplicate = hashes[set.Hashes[index]]
		require.False(t, duplicate)
		hashes[set.Hashes[index]] = struct{}{}
	}
}

func TestNormalizeAcceptsFormattingButRejectsMalformedCodes(t *testing.T) {
	t.Parallel()

	normalized, err := Normalize("abcd-efgh-jkmn-pqrs")
	require.NoError(t, err)
	require.Equal(t, "ABCDEFGHJKMNPQRS", normalized)

	_, err = Normalize("ABCD-EFGH-IJKL-MNOP")
	require.Error(t, err)
	_, err = Normalize("too-short")
	require.Error(t, err)
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

	db := newRecoveryTestDB(t)
	db.SetMaxOpenConns(1)
	service := NewService(db)
	ctx := context.Background()
	now := time.Now().UTC()
	set, err := service.Generate()
	require.NoError(t, err)
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return service.ReplaceWithDB(txCtx, tx, "user-1", set, now)
	}))

	start := make(chan struct{})
	results := make(chan bool, 2)
	errors := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			consumed, consumeErr := service.Consume(ctx, "user-1", set.Codes[0], now.Add(time.Second))
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
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=1", t.Name()))
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
