package idempotency

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type testResult struct {
	ID string `json:"id"`
}

func newStoreTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.NewCreateTable().Model((*record)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `
		CREATE UNIQUE INDEX idempotency_records_scope_key_idx
		ON idempotency_records (principal_id, workspace_id, operation_id, idempotency_key);
		CREATE TABLE effects (id TEXT PRIMARY KEY);
	`)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func requestFor(key string) Request {
	return Request{
		PrincipalID: "token:token-1",
		WorkspaceID: "workspace-1",
		OperationID: "create-publication",
		Key:         key,
		RequestHash: "hash-a",
		HTTPStatus:  201,
		ExpiresAt:   time.Now().UTC().Add(time.Hour),
	}
}

func TestExecuteReplaysTheOriginalResultWithoutRepeatingTheMutation(t *testing.T) {
	t.Parallel()
	db := newStoreTestDB(t)
	mutations := 0
	execute := func(ctx context.Context, tx bun.Tx) (testResult, error) {
		mutations++
		id := fmt.Sprintf("publication-%d", mutations)
		_, err := tx.ExecContext(ctx, "INSERT INTO effects (id) VALUES (?)", id)
		return testResult{ID: id}, err
	}

	first, err := Execute(t.Context(), db, requestFor("event-1"), execute)
	require.NoError(t, err)
	require.False(t, first.Replayed)
	require.Equal(t, testResult{ID: "publication-1"}, first.Value)

	replay, err := Execute(t.Context(), db, requestFor("event-1"), execute)
	require.NoError(t, err)
	require.True(t, replay.Replayed)
	require.Equal(t, first.Value, replay.Value)
	require.Equal(t, 1, mutations)
}

func TestExecuteRejectsKeyReuseWithDifferentInput(t *testing.T) {
	t.Parallel()
	db := newStoreTestDB(t)
	_, err := Execute(t.Context(), db, requestFor("event-2"), func(context.Context, bun.Tx) (testResult, error) {
		return testResult{ID: "publication-1"}, nil
	})
	require.NoError(t, err)

	changed := requestFor("event-2")
	changed.RequestHash = "hash-b"
	_, err = Execute(t.Context(), db, changed, func(context.Context, bun.Tx) (testResult, error) {
		return testResult{ID: "publication-2"}, nil
	})
	require.ErrorIs(t, err, ErrConflict)
}

func TestExecuteRollsBackTheClaimAndMutationTogether(t *testing.T) {
	t.Parallel()
	db := newStoreTestDB(t)
	request := requestFor("event-3")
	_, err := Execute(t.Context(), db, request, func(ctx context.Context, tx bun.Tx) (testResult, error) {
		_, insertErr := tx.ExecContext(ctx, "INSERT INTO effects (id) VALUES ('rolled-back')")
		require.NoError(t, insertErr)
		return testResult{}, errors.New("mutation failed")
	})
	require.EqualError(t, err, "mutation failed")

	result, err := Execute(t.Context(), db, request, func(ctx context.Context, tx bun.Tx) (testResult, error) {
		_, insertErr := tx.ExecContext(ctx, "INSERT INTO effects (id) VALUES ('committed')")
		return testResult{ID: "committed"}, insertErr
	})
	require.NoError(t, err)
	require.False(t, result.Replayed)

	var count int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM effects").Scan(t.Context(), &count))
	require.Equal(t, 1, count)
}

func TestExecuteScopesKeysByPrincipalWorkspaceAndOperation(t *testing.T) {
	t.Parallel()
	db := newStoreTestDB(t)
	requests := []Request{
		requestFor("shared-key"),
		requestFor("shared-key"),
		requestFor("shared-key"),
	}
	requests[1].PrincipalID = "token:token-2"
	requests[2].WorkspaceID = "workspace-2"
	for index, request := range requests {
		result, err := Execute(t.Context(), db, request, func(context.Context, bun.Tx) (testResult, error) {
			return testResult{ID: fmt.Sprintf("publication-%d", index+1)}, nil
		})
		require.NoError(t, err)
		require.False(t, result.Replayed)
	}
}

func TestExecuteSerializesConcurrentDuplicates(t *testing.T) {
	t.Parallel()
	db := newStoreTestDB(t)
	start := make(chan struct{})
	results := make([]Result[testResult], 2)
	errorsByCall := make([]error, 2)
	var mutationCount atomic.Int32
	var wait sync.WaitGroup
	for index := range results {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			results[index], errorsByCall[index] = Execute(t.Context(), db, requestFor("concurrent"), func(context.Context, bun.Tx) (testResult, error) {
				mutationCount.Add(1)
				return testResult{ID: "publication-only"}, nil
			})
		}()
	}
	close(start)
	wait.Wait()

	require.NoError(t, errorsByCall[0])
	require.NoError(t, errorsByCall[1])
	require.Equal(t, int32(1), mutationCount.Load())
	require.Equal(t, results[0].Value, results[1].Value)
	require.NotEqual(t, results[0].Replayed, results[1].Replayed)
}
