package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestRunMigrationsAddsWorkspaceColor(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", t.Name()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	ctx := context.Background()
	_, err = db.ExecContext(ctx, `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL)`)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	for version := int64(1); version <= 55; version++ {
		_, err = db.NewInsert().Model(&SchemaMigration{Version: version, AppliedAt: 1}).Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Launch')`)
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	var color string
	require.NoError(t, db.QueryRowContext(ctx, `SELECT color FROM workspaces WHERE id = 'ws-1'`).Scan(&color))
	require.Equal(t, "#f97316", color)
}
