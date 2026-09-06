package billing

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestSubscriptionSnapshotOrderingSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	exerciseSubscriptionSnapshotOrdering(t, db)
}

func TestSubscriptionSnapshotOrderingPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	schema := fmt.Sprintf("billing_ordering_079_%d", time.Now().UnixNano())
	adminSQLDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(t.Context()))
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	sqlDB := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	sqlDB.SetMaxOpenConns(16)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	exerciseSubscriptionSnapshotOrdering(t, db)
}

func exerciseSubscriptionSnapshotOrdering(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.NewCreateTable().Model((*models.BillingSubscription)(nil)).Exec(t.Context())
	require.NoError(t, err)

	t.Run("equal timestamp replay is an exact no-op", func(t *testing.T) {
		snapshotAt := time.Date(2026, 8, 9, 12, 0, 0, 123_000_000, time.UTC)
		snapshot := orderingSubscription("active", snapshotAt)
		var appliedCount atomic.Int64
		errors := concurrentlyApplySubscription(t.Context(), db, 16, func(int) *models.BillingSubscription {
			copy := *snapshot
			return &copy
		}, &appliedCount)
		require.Empty(t, errors)
		require.Equal(t, int64(1), appliedCount.Load())

		stored := loadOrderingSubscription(t, db)
		require.Equal(t, "active", stored.Status)
		require.True(t, snapshotAt.Equal(stored.ProviderUpdatedAt))
		require.Equal(t, snapshot.RawPayload, stored.RawPayload)
	})

	_, err = db.NewDelete().Model((*models.BillingSubscription)(nil)).Where("1 = 1").Exec(t.Context())
	require.NoError(t, err)

	t.Run("out of order snapshots converge on newest provider version", func(t *testing.T) {
		base := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
		const snapshotCount = 32
		errors := concurrentlyApplySubscription(t.Context(), db, snapshotCount, func(index int) *models.BillingSubscription {
			version := snapshotCount - index
			status := "past_due"
			if version == snapshotCount {
				status = "active"
			}
			return orderingSubscription(status, base.Add(time.Duration(version)*time.Minute))
		}, nil)
		require.Empty(t, errors)

		stored := loadOrderingSubscription(t, db)
		require.Equal(t, "active", stored.Status)
		require.True(t, base.Add(snapshotCount*time.Minute).Equal(stored.ProviderUpdatedAt))
		require.True(t, stored.PastDueSince.IsZero())
	})
}

func concurrentlyApplySubscription(
	ctx context.Context,
	db *bun.DB,
	count int,
	snapshot func(int) *models.BillingSubscription,
	appliedCount *atomic.Int64,
) []error {
	var wg sync.WaitGroup
	start := make(chan struct{})
	errors := make(chan error, count)
	for index := 0; index < count; index++ {
		index := index
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
				applied, upsertErr := upsertSubscription(txCtx, tx, snapshot(index))
				if applied && appliedCount != nil {
					appliedCount.Add(1)
				}
				return upsertErr
			})
			if err != nil {
				errors <- err
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errors)
	result := make([]error, 0, len(errors))
	for err := range errors {
		result = append(result, err)
	}
	return result
}

func orderingSubscription(status string, providerUpdatedAt time.Time) *models.BillingSubscription {
	pastDueSince := time.Time{}
	if status == "past_due" {
		pastDueSince = providerUpdatedAt
	}
	return &models.BillingSubscription{
		OrganizationID:         "org-ordering",
		WorkspaceID:            "workspace-ordering",
		Provider:               ProviderPaddle,
		ProviderCustomerID:     "ctm-ordering",
		ProviderSubscriptionID: "sub-ordering",
		ProviderProductID:      "pro-ordering",
		ProviderPriceID:        "pri-ordering",
		Status:                 status,
		PlanID:                 "founder",
		EntitlementSnapshot:    `{"limits":{}}`,
		ProviderUpdatedAt:      providerUpdatedAt,
		PastDueSince:           pastDueSince,
		RawPayload:             fmt.Sprintf(`{"status":%q,"updated_at":%q}`, status, providerUpdatedAt.Format(time.RFC3339Nano)),
		CreatedAt:              providerUpdatedAt,
		UpdatedAt:              providerUpdatedAt,
	}
}

func loadOrderingSubscription(t *testing.T, db *bun.DB) models.BillingSubscription {
	t.Helper()
	var subscription models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&subscription).Where("organization_id = ?", "org-ordering").Scan(t.Context()))
	return subscription
}
