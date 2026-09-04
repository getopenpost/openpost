package migrations

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestRetireOrganizationWideSSOTokensMigrationUpgradedSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	exerciseRetireOrganizationWideSSOTokensMigration(t, db)
}

func TestRetireOrganizationWideSSOTokensMigrationFailsOnSparseSchema(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := t.Context()
	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("084_retire_organization_wide_sso_tokens.sql")
	require.NoError(t, err)
	pending := migration{
		version: 84,
		name:    "084_retire_organization_wide_sso_tokens.sql",
		sql:     string(raw),
	}
	err = runMigration(ctx, db, pending)
	require.ErrorContains(t, err, "organization_sso_policies")
	exists, err := migrationTableExists(ctx, db, "organization_sso_policies")
	require.NoError(t, err)
	require.False(t, exists, "a failed data migration must not create a partial SSO policy table")

	_, err = db.ExecContext(ctx, `CREATE TABLE organization_sso_policies (
		organization_id TEXT PRIMARY KEY
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, pending.sql)
	require.ErrorContains(t, err, "api_token_mode")
}

func exerciseRetireOrganizationWideSSOTokensMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE organization_sso_policies (
		organization_id TEXT PRIMARY KEY,
		api_token_mode TEXT NOT NULL DEFAULT 'scoped'
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO organization_sso_policies
		(organization_id, api_token_mode) VALUES
		('allow-org', 'allow'),
		('scoped-org', 'scoped'),
		('deny-org', 'deny')`)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("084_retire_organization_wide_sso_tokens.sql")
	require.NoError(t, err)
	migrationSQL := normalizeMigrationSQL(db.Dialect().Name(), string(raw))
	require.NoError(t, runMigration(ctx, db, migration{
		version: 84,
		name:    "084_retire_organization_wide_sso_tokens.sql",
		sql:     migrationSQL,
	}))

	var rows []struct {
		OrganizationID string `bun:"organization_id"`
		APITokenMode   string `bun:"api_token_mode"`
	}
	require.NoError(t, db.NewSelect().Table("organization_sso_policies").
		Column("organization_id", "api_token_mode").Order("organization_id ASC").Scan(ctx, &rows))
	require.Equal(t, []struct {
		OrganizationID string `bun:"organization_id"`
		APITokenMode   string `bun:"api_token_mode"`
	}{
		{OrganizationID: "allow-org", APITokenMode: "scoped"},
		{OrganizationID: "deny-org", APITokenMode: "deny"},
		{OrganizationID: "scoped-org", APITokenMode: "scoped"},
	}, rows)

	_, err = db.ExecContext(ctx, migrationSQL)
	require.NoError(t, err, "the data migration remains idempotent")
}
