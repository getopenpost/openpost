package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesUserImpersonationGrantSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, runTestMigrations(t, db))

	var schema string
	require.NoError(t, db.QueryRowContext(
		ctx,
		"SELECT sql FROM sqlite_master WHERE name = 'user_impersonation_grants'",
	).Scan(&schema))
	require.Contains(t, schema, "token_hash TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE")
	require.Contains(t, schema, "FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN (?, ?, ?)",
			"user_impersonation_grants_admin_created_idx",
			"user_impersonation_grants_target_created_idx",
			"user_impersonation_grants_expiry_idx",
		).
		Scan(ctx, &indexCount))
	require.Equal(t, 3, indexCount)

	var scopeSchema string
	require.NoError(t, db.QueryRowContext(
		ctx,
		"SELECT sql FROM sqlite_master WHERE name = 'user_impersonation_grant_organizations'",
	).Scan(&scopeSchema))
	require.Contains(t, scopeSchema, "PRIMARY KEY (grant_id, organization_id)")
	require.Contains(t, scopeSchema, "FOREIGN KEY (grant_id) REFERENCES user_impersonation_grants(id) ON DELETE CASCADE")
}

func TestRunMigrationsImpersonationGrantForeignKeysCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, created_at)
		VALUES ('user-2', 'target@example.com', 'hash', ?)
	`, time.Now().UTC())
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO user_impersonation_grants (
			id, token_hash, admin_user_id, target_user_id, expires_at, created_at
		) VALUES ('grant-1', 'hash', 'user-1', 'user-2', ?, ?)
	`, time.Now().UTC().Add(time.Minute), time.Now().UTC())
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", "user-2")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("user_impersonation_grants").
		Scan(ctx, &count))
	require.Equal(t, 0, count)
}
