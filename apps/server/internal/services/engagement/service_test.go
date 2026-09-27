package engagement

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestQueuedSyncIgnoresMissingRendition(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", ":memory:")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.NewCreateTable().Model((*models.Rendition)(nil)).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, nil, nil)
	require.NoError(t, service.HandleJob(t.Context(), JobTypeEngagementSync, `{"id":"removed-rendition"}`))
}
