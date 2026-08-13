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

func TestEnsureComposerExperienceUserFieldAddsSpecializedDefault(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()

	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO users (id, email) VALUES ('user-1', 'user@example.com')`)
	require.NoError(t, err)

	require.NoError(t, ensureComposerExperienceUserField(ctx, db))

	var experience string
	require.NoError(t, db.NewSelect().Table("users").Column("composer_experience").Where("id = ?", "user-1").Scan(ctx, &experience))
	require.Equal(t, "specialized", experience)
	require.NoError(t, ensureComposerExperienceUserField(ctx, db))
}
