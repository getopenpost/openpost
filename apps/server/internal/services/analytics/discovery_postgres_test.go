package analytics

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestDiscoveryProviderConcurrencyLeaseUpsertOnPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	adminSQL := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQL, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(t.Context()))

	schema := fmt.Sprintf("discovery_lease_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	scopedSQL := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	db := bun.NewDB(scopedSQL, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	_, err = db.NewCreateTable().Model((*models.AccountContentDiscoveryLease)(nil)).Exec(t.Context())
	require.NoError(t, err)

	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	service := NewService(db, nil)
	firstCtx := providerwrite.WithJobExecution(t.Context(), "job-first", 0, now)
	owner, acquired, err := service.acquireDiscoveryProviderSlot(firstCtx, "threads", 1, now)
	require.NoError(t, err)
	require.True(t, acquired)
	require.Equal(t, "job-first", owner)

	secondCtx := providerwrite.WithJobExecution(t.Context(), "job-second", 0, now)
	_, acquired, err = service.acquireDiscoveryProviderSlot(secondCtx, "threads", 1, now.Add(discoveryLeaseTTL-time.Nanosecond))
	require.NoError(t, err)
	require.False(t, acquired)

	owner, acquired, err = service.acquireDiscoveryProviderSlot(secondCtx, "threads", 1, now.Add(discoveryLeaseTTL))
	require.NoError(t, err)
	require.True(t, acquired)
	require.Equal(t, "job-second", owner)
}
