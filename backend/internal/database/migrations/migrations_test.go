package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestRunMigrationsRemovesSocialSetsAndPromotesSchedules(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	ctx := context.Background()

	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
		(*models.PostVariant)(nil),
		(*models.PostingSchedule)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.Exec(`CREATE TABLE social_media_sets (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		name TEXT NOT NULL,
		is_default BOOLEAN DEFAULT FALSE,
		created_at TIMESTAMP
	)`)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE social_media_set_accounts (
		set_id TEXT NOT NULL,
		social_account_id TEXT NOT NULL,
		is_main BOOLEAN DEFAULT FALSE,
		PRIMARY KEY (set_id, social_account_id)
	)`)
	require.NoError(t, err)

	accounts := []models.SocialAccount{
		{ID: "active-account", WorkspaceID: "ws-1", Platform: "x", AccountID: "1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "inactive-account", WorkspaceID: "ws-1", Platform: "x", AccountID: "2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", "inactive-account").Exec(ctx)
	require.NoError(t, err)

	_, err = db.Exec(`INSERT INTO social_media_sets (id, workspace_id, name) VALUES ('set-1', 'ws-1', 'Primary')`)
	require.NoError(t, err)

	_, err = db.Exec(`INSERT INTO social_media_set_accounts (set_id, social_account_id) VALUES
		('set-1', 'active-account'),
		('set-1', 'inactive-account'),
		('set-1', 'missing-account')`)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.PostingSchedule{
		ID:          "slot-1",
		WorkspaceID: "ws-1",
		SetID:       "set-1",
		UTCHour:     9,
		UTCMinute:   30,
		DayOfWeek:   1,
		IsActive:    true,
	}).Exec(ctx)
	require.NoError(t, err)

	err = RunMigrations(db)
	require.NoError(t, err)

	var schedule models.PostingSchedule
	err = db.NewSelect().Model(&schedule).Where("id = ?", "slot-1").Scan(ctx)
	require.NoError(t, err)
	require.Empty(t, schedule.SetID)

	_, err = db.Exec("SELECT 1 FROM social_media_sets LIMIT 1")
	require.Error(t, err)
	_, err = db.Exec("SELECT 1 FROM social_media_set_accounts LIMIT 1")
	require.Error(t, err)
}

func TestRunMigrationsPromotesSingleExistingUserToInstanceAdmin(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	ctx := context.Background()

	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
		(*models.PostVariant)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}

	_, err = db.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			totp_secret_encrypted BLOB,
			totp_enabled_at TIMESTAMP,
			passkey_enabled_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		)
	`)
	require.NoError(t, err)

	_, err = db.Exec(`INSERT INTO users (id, email, password_hash) VALUES ('user-1', 'admin@example.com', 'hash')`)
	require.NoError(t, err)

	err = RunMigrations(db)
	require.NoError(t, err)

	var user models.User
	err = db.NewSelect().Model(&user).Where("id = ?", "user-1").Scan(ctx)
	require.NoError(t, err)
	require.True(t, user.IsAdmin)
}

func TestNormalizeMigrationSQLLeavesSQLiteStatementsUnchanged(t *testing.T) {
	t.Parallel()

	raw := `
ALTER TABLE users ADD COLUMN totp_secret_encrypted BLOB;
ALTER TABLE users ADD COLUMN totp_enabled_at DATETIME;
DELETE FROM social_accounts WHERE is_active = 0;
CREATE UNIQUE INDEX social_accounts_active_idx ON social_accounts (workspace_id) WHERE is_active = 1;
`

	require.Equal(t, raw, normalizeMigrationSQL(dialect.SQLite, raw))
}

func TestNormalizeMigrationSQLMakesStatementsPostgresSafe(t *testing.T) {
	t.Parallel()

	raw := `
ALTER TABLE users ADD COLUMN totp_secret_encrypted BLOB;
ALTER TABLE users ADD COLUMN totp_enabled_at DATETIME;
ALTER TABLE media_attachments ADD COLUMN public_url_ready BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN public_url_public BOOLEAN DEFAULT 1;
DELETE FROM social_accounts WHERE is_active = 0;
CREATE UNIQUE INDEX social_accounts_active_idx ON social_accounts (workspace_id) WHERE is_active = 1 AND slug != '';
`

	got := normalizeMigrationSQL(dialect.PG, raw)

	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted BYTEA")
	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ")
	require.Contains(t, got, "ALTER TABLE media_attachments ADD COLUMN IF NOT EXISTS public_url_ready BOOLEAN NOT NULL DEFAULT FALSE")
	require.Contains(t, got, "ALTER TABLE media_attachments ADD COLUMN IF NOT EXISTS public_url_public BOOLEAN DEFAULT TRUE")
	require.Contains(t, got, "totp_secret_encrypted BYTEA")
	require.Contains(t, got, "totp_enabled_at TIMESTAMPTZ")
	require.Contains(t, got, "is_active = FALSE")
	require.Contains(t, got, "is_active = TRUE AND slug != ''")
	require.NotContains(t, got, " BLOB")
	require.NotContains(t, got, " DATETIME")
	require.NotContains(t, got, "BOOLEAN NOT NULL DEFAULT 0")
	require.NotContains(t, got, "BOOLEAN DEFAULT 1")
	require.NotContains(t, got, "is_active = 0")
	require.NotContains(t, got, "is_active = 1")
}

func TestRemoveGlobalMediaHashConstraintKeepsIndexesAndAllowsWorkspaceScopedHashes(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	ctx := context.Background()

	_, err = db.ExecContext(ctx, `CREATE TABLE media_attachments (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		"file_hash" VARCHAR,
		source TEXT NOT NULL DEFAULT 'upload',
		asset_kind TEXT NOT NULL DEFAULT 'library',
		original_filename TEXT NOT NULL DEFAULT '',
		UNIQUE ("file_hash")
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE INDEX media_workspace_created_idx ON media_attachments (workspace_id, original_filename)`)
	require.NoError(t, err)

	require.NoError(t, removeGlobalMediaHashConstraint(ctx, db))
	_, err = db.ExecContext(ctx, `INSERT INTO media_attachments (id, workspace_id, file_hash) VALUES
		('media-1', 'workspace-1', 'same-hash'),
		('media-2', 'workspace-2', 'same-hash')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX media_workspace_hash_idx
		ON media_attachments (workspace_id, file_hash)
		WHERE source = 'upload' AND asset_kind = 'library'`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO media_attachments (id, workspace_id, file_hash)
		VALUES ('media-3', 'workspace-1', 'same-hash')`)
	require.Error(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO media_attachments (id, workspace_id, file_hash, source, asset_kind)
		VALUES ('media-4', 'workspace-1', 'same-hash', 'studio_export', 'library')`)
	require.NoError(t, err)

	var indexCount int
	err = db.NewSelect().
		TableExpr("sqlite_master").
		ColumnExpr("COUNT(*)").
		Where("type = 'index' AND name = ?", "media_workspace_created_idx").
		Scan(ctx, &indexCount)
	require.NoError(t, err)
	require.Equal(t, 1, indexCount)
}
