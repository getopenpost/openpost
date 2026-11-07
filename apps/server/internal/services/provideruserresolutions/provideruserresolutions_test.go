package provideruserresolutions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newResolutionTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_busy_timeout=5000", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(8)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	_, err = db.NewCreateTable().Model((*models.ProviderUserResolution)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	// The composite unique key lives in the SQL migration, not in Bun model
	// tags; create it here so upserts match production behavior.
	_, err = db.ExecContext(t.Context(), "CREATE UNIQUE INDEX IF NOT EXISTS provider_user_resolutions_provider_workspace_handle_idx ON provider_user_resolutions (provider, workspace_id, handle)")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func TestResolveCachesLookupsPerWorkspaceAndProvider(t *testing.T) {
	db := newResolutionTestDB(t)
	service := NewService(db)
	lookupCalls := 0
	lookup := func(_ context.Context, handles []string) (map[string]string, error) {
		lookupCalls++
		resolved := map[string]string{}
		for _, handle := range handles {
			resolved[handle] = "user-" + handle
		}
		return resolved, nil
	}

	resolved, err := service.Resolve(t.Context(), "ws-1", "x", []string{" @Alice ", "bob", "alice"}, lookup)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"alice": "user-alice", "bob": "user-bob"}, resolved)
	require.Equal(t, 1, lookupCalls)

	// The second resolve hits the cache and performs no lookup.
	resolved, err = service.Resolve(t.Context(), "ws-1", "x", []string{"alice", "bob"}, lookup)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"alice": "user-alice", "bob": "user-bob"}, resolved)
	require.Equal(t, 1, lookupCalls)

	var stored models.ProviderUserResolution
	require.NoError(t, db.NewSelect().Model(&stored).Where("workspace_id = ? AND provider = ? AND handle = ?", "ws-1", "x", "alice").Scan(t.Context()))
	require.Equal(t, "user-alice", stored.ProviderUserID)
	require.False(t, stored.ResolvedAt.IsZero())

	// Another workspace or provider does not share the cache.
	lookupCalls = 0
	resolved, err = service.Resolve(t.Context(), "ws-2", "x", []string{"alice"}, lookup)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"alice": "user-alice"}, resolved)
	require.Equal(t, 1, lookupCalls)
	resolved, err = service.Resolve(t.Context(), "ws-1", "mastodon", []string{"alice"}, lookup)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"alice": "user-alice"}, resolved)
	require.Equal(t, 2, lookupCalls)
}

func TestResolveUpsertsConcurrentLookupsForSameHandle(t *testing.T) {
	db := newResolutionTestDB(t)
	service := NewService(db)
	// Two concurrent resolves for the same handle both miss the cache and
	// both store their lookup result. The upsert keeps the second write from
	// failing the batch on the unique (provider, workspace_id, handle) key.
	const resolvers = 2
	var barrier sync.WaitGroup
	barrier.Add(resolvers)
	outcomes := make(chan string, resolvers)
	for index := 0; index < resolvers; index++ {
		go func(index int) {
			resolved, err := service.Resolve(context.Background(), "ws-1", "x", []string{"alice"}, func(context.Context, []string) (map[string]string, error) {
				barrier.Done()
				barrier.Wait()
				return map[string]string{"alice": fmt.Sprintf("user-%d", index)}, nil
			})
			if err != nil {
				outcomes <- err.Error()
				return
			}
			outcomes <- resolved["alice"]
		}(index)
	}
	for index := 0; index < resolvers; index++ {
		select {
		case outcome := <-outcomes:
			require.NotEmpty(t, outcome, "every concurrent resolve must return a stored user ID")
		case <-time.After(5 * time.Second):
			t.Fatal("concurrent resolution deadlocked")
		}
	}
	count, err := db.NewSelect().Model((*models.ProviderUserResolution)(nil)).
		Where("workspace_id = ? AND provider = ? AND handle = ?", "ws-1", "x", "alice").Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

func TestResolveFailsBatchOnLookupErrorOrMissingHandle(t *testing.T) {
	service := NewService(newResolutionTestDB(t))
	lookupErr := errors.New("provider lookup unavailable")
	_, err := service.Resolve(t.Context(), "ws-1", "x", []string{"alice"}, func(context.Context, []string) (map[string]string, error) {
		return nil, lookupErr
	})
	require.ErrorIs(t, err, lookupErr)

	_, err = service.Resolve(t.Context(), "ws-1", "x", []string{"alice"}, func(context.Context, []string) (map[string]string, error) {
		return map[string]string{}, nil
	})
	require.ErrorContains(t, err, "@alice could not be resolved")

	resolved, err := service.Resolve(t.Context(), "ws-1", "x", nil, func(context.Context, []string) (map[string]string, error) {
		t.Fatal("empty handle lists must not reach the lookup")
		return nil, nil
	})
	require.NoError(t, err)
	require.Empty(t, resolved)
}
