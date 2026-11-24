package analytics

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func analyticsSnapshotTestDB(t testing.TB, backend string, extraModels ...any) *bun.DB {
	t.Helper()
	var db *bun.DB
	if backend == "postgres" {
		dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
		if dsn == "" {
			t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
		}
		db = bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
		schema := fmt.Sprintf("analytics_test_%d", time.Now().UnixNano())
		_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
			require.NoError(t, err)
		})
		_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
		require.NoError(t, err)
	} else {
		var err error
		db, err = testdb.Open("file:" + filepath.Join(t.TempDir(), "snapshots.db") + "?mode=rwc")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
	}
	_, err := db.NewCreateTable().Model((*models.AnalyticsRenditionSnapshot)(nil)).Exec(t.Context())
	require.NoError(t, err)
	for _, model := range extraModels {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	// Match the indexes owned by migrations 043, 048 and 157.
	for _, statement := range []string{
		`CREATE INDEX analytics_rendition_snapshots_rendition_captured_idx ON analytics_rendition_snapshots (rendition_id, captured_at)`,
		`CREATE INDEX analytics_rendition_snapshots_workspace_captured_idx ON analytics_rendition_snapshots (workspace_id, captured_at)`,
		`CREATE INDEX analytics_rendition_snapshots_rendition_workspace_captured_idx ON analytics_rendition_snapshots (rendition_id, workspace_id, captured_at)`,
		`CREATE UNIQUE INDEX analytics_rendition_snapshots_capture_key_idx ON analytics_rendition_snapshots (rendition_id, capture_key) WHERE capture_key <> ''`,
	} {
		_, err := db.ExecContext(t.Context(), statement)
		require.NoError(t, err)
	}
	return db
}
