package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestRetireOrganizationWideSSOTokensMigrationFreshSQLite(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	organization := &models.Organization{
		ID: "fresh-sso-org", Name: "Fresh SSO", CreatedByID: "user-1",
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(organization).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationSSOPolicy{
		OrganizationID: organization.ID,
	}).Column("organization_id").Exec(ctx)
	require.NoError(t, err)

	var policy models.OrganizationSSOPolicy
	require.NoError(t, db.NewSelect().Model(&policy).
		Where("organization_id = ?", organization.ID).Scan(ctx))
	require.Equal(t, models.OrganizationSSOTokensScoped, policy.APITokenMode)

	var applied SchemaMigration
	require.NoError(t, db.NewSelect().Model(&applied).Where("version = ?", 84).Scan(ctx))
}

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

func TestRetireOrganizationWideSSOTokensMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	adminSQLDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(t.Context()))

	schema := fmt.Sprintf("sso_token_mode_084_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	scopedSQLDB := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	scopedSQLDB.SetMaxOpenConns(1)
	db := bun.NewDB(scopedSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	exerciseRetireOrganizationWideSSOTokensMigration(t, db)
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
