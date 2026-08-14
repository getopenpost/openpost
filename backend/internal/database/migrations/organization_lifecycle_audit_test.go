package migrations

import (
	"database/sql"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestOrganizationLifecycleAuditSurvivesOrganizationDeletion(t *testing.T) {
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+uuid.NewString()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.ExecContext(t.Context(), "PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	for _, statement := range []string{
		`CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL)`,
		`CREATE TABLE users (id TEXT PRIMARY KEY)`,
		`CREATE TABLE organizations (id TEXT PRIMARY KEY)`,
		`INSERT INTO users (id) VALUES ('owner')`,
		`INSERT INTO organizations (id) VALUES ('org')`,
	} {
		_, err = db.ExecContext(t.Context(), statement)
		require.NoError(t, err)
	}
	raw, err := migrationFiles.ReadFile("101_organization_lifecycle_audit.sql")
	require.NoError(t, err)
	item := migration{version: 101, name: "101_organization_lifecycle_audit.sql", sql: normalizeMigrationSQL(db.Dialect().Name(), string(raw))}
	require.NoError(t, runMigration(t.Context(), db, item))
	_, err = db.ExecContext(t.Context(), `INSERT INTO organization_lifecycle_audit_events (id, organization_id, organization_name, workspace_count, billing_state, actor_user_id, action) VALUES ('event', 'org', 'Studio', 2, 'canceled', 'owner', 'organization.deleted')`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO billing_checkout_cancellations (checkout_attempt_id, organization_id, canceled_at) VALUES ('checkout', 'org', current_timestamp)`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `DELETE FROM organizations WHERE id = 'org'`)
	require.NoError(t, err)
	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("organization_lifecycle_audit_events").Scan(t.Context(), &count))
	require.Equal(t, 1, count)
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("billing_checkout_cancellations").Scan(t.Context(), &count))
	require.Equal(t, 1, count)
}
