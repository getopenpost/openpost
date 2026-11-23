package ratelimit

import (
	"database/sql"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestSharedLimitAcrossReplicas(t *testing.T) {
	raw, err := sql.Open(sqliteshim.ShimName, ":memory:")
	require.NoError(t, err)
	raw.SetMaxOpenConns(1)
	db := bun.NewDB(raw, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec("CREATE TABLE auth_rate_limits (key_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL, attempts BIGINT NOT NULL)")
	require.NoError(t, err)
	replicas := []*Limiter{NewShared(db), NewShared(db)}
	var allowed atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if replicas[i%2].Allow("login:email:private@example.com", 10, time.Minute) {
				allowed.Add(1)
			}
		}(i)
	}
	wg.Wait()
	require.EqualValues(t, 10, allowed.Load())
	var stored string
	require.NoError(t, db.NewRaw("SELECT key_hash FROM auth_rate_limits").Scan(t.Context(), &stored))
	require.NotContains(t, stored, "private")
	_, err = db.Exec("UPDATE auth_rate_limits SET expires_at = 0")
	require.NoError(t, err)
	require.True(t, replicas[0].Allow("login:email:private@example.com", 10, time.Minute))
	_, err = db.Exec("DROP TABLE auth_rate_limits")
	require.NoError(t, err)
	require.False(t, replicas[0].Allow("other", 10, time.Minute))
}
