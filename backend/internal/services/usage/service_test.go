package usage

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newUsageTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.UsageCounter)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func TestMonthStartNormalizesToUTCFirstOfMonth(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Lisbon")
	require.NoError(t, err)

	got := MonthStart(time.Date(2026, 6, 30, 23, 30, 0, 0, loc))

	require.Equal(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC), got)
}

func TestIncrementMonthlyCreatesAndAggregatesCounter(t *testing.T) {
	db := newUsageTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	when := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)

	value, err := service.IncrementMonthly(ctx, "ws-1", entitlements.LimitMediaBytesUploadedMonthly, 1024, when)
	require.NoError(t, err)
	require.Equal(t, int64(1024), value)

	value, err = service.IncrementMonthly(ctx, "ws-1", entitlements.LimitMediaBytesUploadedMonthly, 512, when)
	require.NoError(t, err)
	require.Equal(t, int64(1536), value)

	current, err := service.CurrentMonthly(ctx, "ws-1", entitlements.LimitMediaBytesUploadedMonthly, when)
	require.NoError(t, err)
	require.Equal(t, int64(1536), current)
}

func TestIncrementMonthlyKeepsPeriodsSeparate(t *testing.T) {
	db := newUsageTestDB(t)
	service := NewService(db)
	ctx := context.Background()

	_, err := service.IncrementMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, 2, time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	_, err = service.IncrementMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, 3, time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	require.NoError(t, err)

	june, err := service.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	require.Equal(t, int64(2), june)

	july, err := service.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	require.Equal(t, int64(3), july)
}

func TestSnapshotMonthlyReturnsMetricsForPeriod(t *testing.T) {
	db := newUsageTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	when := time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)

	_, err := service.IncrementMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, 7, when)
	require.NoError(t, err)
	_, err = service.IncrementMonthly(ctx, "ws-1", entitlements.LimitProviderWriteCallsMonthly, 11, when)
	require.NoError(t, err)

	snapshot, err := service.SnapshotMonthly(ctx, "ws-1", when)
	require.NoError(t, err)
	require.Equal(t, int64(7), snapshot[entitlements.LimitScheduledPostsMonthly])
	require.Equal(t, int64(11), snapshot[entitlements.LimitProviderWriteCallsMonthly])
}

func TestIncrementMonthlyRejectsInvalidAmount(t *testing.T) {
	db := newUsageTestDB(t)
	service := NewService(db)

	_, err := service.IncrementMonthly(context.Background(), "ws-1", entitlements.LimitScheduledPostsMonthly, 0, time.Now())
	require.ErrorContains(t, err, "amount must be positive")
}
