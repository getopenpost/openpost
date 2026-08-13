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

func TestEnsurePublicProfileUserFieldsBackfillsUniqueUsernames(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	ctx := context.Background()
	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO users (id, email) VALUES
		('user-one', 'maker@example.com'),
		('user-two', 'maker@another.example')`)
	require.NoError(t, err)

	require.NoError(t, ensurePublicProfileUserFields(ctx, db))
	var rows []struct {
		Username      string `bun:"username"`
		PublicProfile bool   `bun:"public_profile_enabled"`
	}
	require.NoError(t, db.NewSelect().Table("users").Column("username", "public_profile_enabled").Order("id ASC").Scan(ctx, &rows))
	require.Len(t, rows, 2)
	require.Equal(t, "maker", rows[0].Username)
	require.NotEqual(t, rows[0].Username, rows[1].Username)
	require.False(t, rows[0].PublicProfile)
	require.False(t, rows[1].PublicProfile)
}
