package drafts

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestChangedDomainsSinceReturnsOnlySafeCoarseDomains(t *testing.T) {
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file::memory:?cache=shared")
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	_, err = db.NewCreateTable().Model((*models.DraftRevisionChange)(nil)).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.User)(nil)).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID: "user-2", Email: "alex@example.com", DisplayName: "Alex", PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)

	now := time.Now().UTC()
	require.NoError(t, RecordChange(ctx, db, AggregatePublication, "pub-1", 2, []string{"content", "media"}, "user-1", now))
	require.NoError(t, RecordChange(ctx, db, AggregatePublication, "pub-1", 3, []string{"destinations", "content"}, "user-2", now))

	domains, err := ChangedDomainsSince(ctx, db, AggregatePublication, "pub-1", 1)
	require.NoError(t, err)
	require.Equal(t, []string{"content", "destinations", "media"}, domains)
	editor, err := LatestEditorName(ctx, db, AggregatePublication, "pub-1", 1)
	require.NoError(t, err)
	require.Equal(t, "Alex", editor)
}
