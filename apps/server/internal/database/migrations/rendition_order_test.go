package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestRenditionOrderMigrationPreservesIndependentPublicationOrder(t *testing.T) {
	testRenditionOrderMigration(t, newMigrationsTestDB(t))
}

func TestRenditionOrderMigrationOnPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	db := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("rendition_order_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	testRenditionOrderMigration(t, db)
}

func testRenditionOrderMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `CREATE TABLE renditions (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, created_at TIMESTAMP NOT NULL);
      INSERT INTO renditions (id,publication_id,created_at) VALUES
      ('b','first','2026-09-30 12:00:00'), ('a','first','2026-09-30 12:00:00'),
      ('c','first','2026-09-29 12:00:00'), ('d','second','2026-09-30 12:00:00');`)
	require.NoError(t, err)
	source, err := migrationFiles.ReadFile("149_rendition_authoring_order.sql")
	require.NoError(t, err)
	migration := fstest.MapFS{"149_rendition_authoring_order.sql": {Data: source}}
	for range 2 {
		require.NoError(t, runMigrations(db, migration))
		var rows []struct {
			ID            string
			PublicationID string
			Position      int
		}
		require.NoError(t, db.NewSelect().Table("renditions").Column("id", "publication_id", "position").Order("publication_id ASC", "position ASC").Scan(t.Context(), &rows))
		require.Len(t, rows, 4)
		require.Equal(t, []string{"c", "a", "b", "d"}, []string{rows[0].ID, rows[1].ID, rows[2].ID, rows[3].ID})
		require.Equal(t, []int{0, 1, 2, 0}, []int{rows[0].Position, rows[1].Position, rows[2].Position, rows[3].Position})
	}
}
