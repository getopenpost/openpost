package migrations

import (
	"context"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestRunMigrationsCreatesAPITokensSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'api_tokens'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "token_hash TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "scope TEXT NOT NULL DEFAULT 'cli:full'")
	require.Contains(t, schema, "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('api_tokens_user_id_idx', 'api_tokens_token_prefix_idx', 'api_tokens_active_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 3, indexCount)
}

func TestRunMigrationsAPITokensIdempotent(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix)
		VALUES ('token-1', 'user-1', 'CLI', 'hash-1', 'abc12345')
	`)
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("api_tokens").Scan(ctx, &count))
	require.Equal(t, 1, count)
}

func TestRunMigrationsAPITokensForeignKeyCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix)
		VALUES ('token-1', 'user-1', 'CLI', 'hash-1', 'abc12345')
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", "user-1")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("api_tokens").Scan(ctx, &count))
	require.Equal(t, 0, count)
}

func TestRunMigrationsAPITokensPrefixLookupAndHashUniqueness(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	_, err := db.ExecContext(ctx, `
		INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix)
		VALUES ('token-1', 'user-1', 'CLI', 'hash-1', 'abc12345')
	`)
	require.NoError(t, err)

	var token models.APIToken
	require.NoError(t, db.NewSelect().
		Model(&token).
		Where("token_prefix = ?", "abc12345").
		Scan(ctx))
	require.Equal(t, "token-1", token.ID)

	_, err = db.ExecContext(ctx, `
		INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix)
		VALUES ('token-2', 'user-1', 'Duplicate', 'hash-1', 'def67890')
	`)
	require.Error(t, err)
	require.Contains(t, strings.ToLower(err.Error()), "unique")
}

func seedMigrationUser(ctx context.Context, t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user-1@example.com",
		PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
}
