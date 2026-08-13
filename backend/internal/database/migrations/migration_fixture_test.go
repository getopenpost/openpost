package migrations

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// runTestMigrations mirrors the production bootstrap boundary before applying
// embedded migrations. Historical fixture tests can keep their narrow legacy
// tables, while migrations 083 and 084 still fail closed outside this helper
// when an already-applied prerequisite schema is actually missing.
func runTestMigrations(t *testing.T, db *bun.DB) error {
	t.Helper()
	for _, model := range []any{
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostVariant)(nil),
		(*models.Job)(nil),
	} {
		if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context()); err != nil {
			return err
		}
	}
	if err := ensureSSOPolicyMigrationFixture(t, db); err != nil {
		return err
	}
	return RunMigrations(db)
}

func ensureSSOPolicyMigrationFixture(t *testing.T, db *bun.DB) error {
	schemaExists, err := migrationTableExists(t.Context(), db, "schema_migrations")
	if err != nil || !schemaExists {
		return err
	}
	applied, err := db.NewSelect().Model((*SchemaMigration)(nil)).Where("version = ?", 51).Exists(t.Context())
	if err != nil || !applied {
		return err
	}
	_, err = db.ExecContext(t.Context(), `CREATE TABLE IF NOT EXISTS organization_sso_policies (
		organization_id TEXT PRIMARY KEY,
		mode TEXT NOT NULL DEFAULT 'disabled',
		provider_ids TEXT NOT NULL DEFAULT '[]',
		assurance_max_age_seconds INTEGER NOT NULL DEFAULT 43200,
		password_login_allowed BOOLEAN NOT NULL DEFAULT true,
		api_token_mode TEXT NOT NULL DEFAULT 'scoped',
		max_token_lifetime_seconds INTEGER NOT NULL DEFAULT 2592000,
		require_token_reauth BOOLEAN NOT NULL DEFAULT true,
		updated_by_user_id TEXT,
		created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
		updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
	)`)
	return err
}
