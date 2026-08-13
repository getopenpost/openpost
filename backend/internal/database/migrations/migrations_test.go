package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestRunMigrationsReplacesLegacySocialSetsAndPromotesSchedules(t *testing.T) {
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
	_, err = db.NewInsert().Model(&models.Workspace{
		ID: "ws-1", Name: "Workspace", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
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

	err = runTestMigrations(t, db)
	require.NoError(t, err)

	var schedule models.PostingSchedule
	err = db.NewSelect().Model(&schedule).Where("id = ?", "slot-1").Scan(ctx)
	require.NoError(t, err)
	require.Empty(t, schedule.SetID)

	_, err = db.Exec("SELECT 1 FROM social_media_sets LIMIT 1")
	require.Error(t, err)
	_, err = db.Exec("SELECT 1 FROM social_media_set_accounts LIMIT 1")
	require.Error(t, err)

	var socialSet models.SocialSet
	err = db.NewSelect().Model(&socialSet).Where("workspace_id = ?", "ws-1").Scan(ctx)
	require.NoError(t, err)
	require.Equal(t, "All channels", socialSet.Name)
	require.True(t, socialSet.IsDefault)

	var setAccounts []models.SocialSetAccount
	err = db.NewSelect().Model(&setAccounts).Where("social_set_id = ?", socialSet.ID).Scan(ctx)
	require.NoError(t, err)
	require.Len(t, setAccounts, 1)
	require.Equal(t, "active-account", setAccounts[0].SocialAccountID)
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

	err = runTestMigrations(t, db)
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
ALTER TABLE social_accounts
  ADD COLUMN granted_scopes TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS already_safe TEXT;
SELECT 'ADD COLUMN stays literal';
-- ADD COLUMN stays a comment
ALTER TABLE media_attachments ADD COLUMN public_url_ready BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN public_url_public BOOLEAN DEFAULT 1;
DELETE FROM social_accounts WHERE is_active = 0;
CREATE UNIQUE INDEX social_accounts_active_idx ON social_accounts (workspace_id) WHERE is_active = 1 AND slug != '';
`

	got := normalizeMigrationSQL(dialect.PG, raw)

	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted BYTEA")
	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ")
	require.Contains(t, got, "ALTER TABLE social_accounts\n  ADD COLUMN IF NOT EXISTS granted_scopes TEXT NOT NULL DEFAULT ''")
	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS already_safe TEXT")
	require.NotContains(t, got, "ADD COLUMN IF NOT EXISTS IF NOT EXISTS")
	require.Contains(t, got, "SELECT 'ADD COLUMN stays literal'")
	require.Contains(t, got, "-- ADD COLUMN stays a comment")
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

func TestOIDCSSOMigrationAllowsPasswordlessUsersAndBackfillsOrganizationMembers(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()

	_, err = db.ExecContext(ctx, `
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL DEFAULT '',
			avatar_url TEXT NOT NULL DEFAULT '',
			avatar_object_key TEXT NOT NULL DEFAULT '',
			password_hash TEXT NOT NULL,
			is_admin BOOLEAN NOT NULL DEFAULT false,
			totp_secret_encrypted BLOB,
			totp_enabled_at DATETIME,
			passkey_enabled_at DATETIME,
			terms_version TEXT NOT NULL DEFAULT '',
			privacy_version TEXT NOT NULL DEFAULT '',
			legal_accepted_at DATETIME,
			created_at DATETIME NOT NULL DEFAULT current_timestamp
		)
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash)
		VALUES
		  ('owner', 'owner@example.com', 'hash'),
		  ('member', 'member@example.com', 'hash'),
		  ('workspace-admin', 'workspace-admin@example.com', 'hash')
	`)
	require.NoError(t, err)

	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.UserSession)(nil),
		(*models.APIToken)(nil),
		(*models.MCPOAuthCode)(nil),
		(*models.CLIAuthSession)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{
		ID: "org", Name: "Organization", CreatedByID: "owner", CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org", UserID: "owner", Role: models.OrganizationRoleOwner, CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{
		ID: "workspace", OrganizationID: "org", Name: "Workspace", CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.WorkspaceMember{
		{WorkspaceID: "workspace", UserID: "member", Role: models.WorkspaceRoleEditor},
		{WorkspaceID: "workspace", UserID: "workspace-admin", Role: models.WorkspaceRoleAdmin},
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	applied := make([]SchemaMigration, 0, 50)
	for version := int64(1); version <= 50; version++ {
		applied = append(applied, SchemaMigration{Version: version, AppliedAt: now.Unix()})
	}
	_, err = db.NewInsert().Model(&applied).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))

	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash)
		VALUES ('oidc-user', 'oidc@example.com', NULL)
	`)
	require.NoError(t, err)

	var member models.OrganizationMember
	require.NoError(t, db.NewSelect().Model(&member).
		Where("organization_id = ? AND user_id = ?", "org", "member").
		Scan(ctx))
	require.Equal(t, models.OrganizationRoleMember, member.Role)
	require.NoError(t, db.NewSelect().Model(&member).
		Where("organization_id = ? AND user_id = ?", "org", "workspace-admin").
		Scan(ctx))
	require.Equal(t, models.OrganizationRoleMember, member.Role)

	for _, table := range []string{
		"identity_providers",
		"user_identities",
		"oidc_auth_requests",
		"organization_sso_policies",
		"session_identity_assurances",
		"reauth_grants",
		"oidc_native_handoffs",
		"identity_audit_events",
	} {
		exists, err := migrationTableExists(ctx, db, table)
		require.NoError(t, err)
		require.True(t, exists, "expected %s table", table)
	}
}

func TestOIDCSSOMigrationNormalizesForPostgres(t *testing.T) {
	t.Parallel()

	raw, err := migrationFiles.ReadFile("051_oidc_sso.sql")
	require.NoError(t, err)
	got := normalizeMigrationSQL(dialect.PG, string(raw))

	require.Contains(t, got, "client_secret_encrypted BYTEA")
	require.Contains(t, got, "pkce_verifier_encrypted BYTEA NOT NULL")
	require.Contains(t, got, "auth_time TIMESTAMPTZ NOT NULL")
	require.Contains(t, got, "ADD COLUMN IF NOT EXISTS is_break_glass BOOLEAN NOT NULL DEFAULT false")
	require.NotContains(t, got, " BLOB")
	require.NotContains(t, got, " DATETIME")
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
		VALUES ('media-4', 'workspace-1', 'same-hash', 'image_editor_export', 'library')`)
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
