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

func TestEmailVerificationMigrationBackfillsExistingUsersAndCreatesChallenges(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqldb.Close()) })
	db := bun.NewDB(sqldb, sqlitedialect.New())
	ctx := context.Background()

	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT,
		created_at DATETIME NOT NULL DEFAULT current_timestamp
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO users (id, email, password_hash)
		VALUES ('existing-user', 'existing@example.com', 'hash')`)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	for version := int64(1); version < 58; version++ {
		_, err = db.NewInsert().Model(&SchemaMigration{Version: version, AppliedAt: 1}).Exec(ctx)
		require.NoError(t, err)
	}

	require.NoError(t, runTestMigrations(t, db))

	var verifiedAt sql.NullTime
	require.NoError(t, db.NewSelect().Table("users").Column("email_verified_at").
		Where("id = ?", "existing-user").Scan(ctx, &verifiedAt))
	require.True(t, verifiedAt.Valid)

	exists, err := migrationTableExists(ctx, db, "email_verification_challenges")
	require.NoError(t, err)
	require.True(t, exists)
}
