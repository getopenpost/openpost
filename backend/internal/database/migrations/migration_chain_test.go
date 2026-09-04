package migrations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
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

func newMigrationsTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)

	// Match production: single connection so PRAGMA settings (foreign
	// keys, busy_timeout, journal mode) are reliably visible to every
	// subsequent statement on this DB.
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())

	// Match production: enable foreign keys so cascade constraints work
	// in tests as they would in the real binary.
	_, err = db.Exec("PRAGMA foreign_keys=ON")
	require.NoError(t, err)

	modelList := []interface{}{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.ThreadDraft)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
	}
	for _, m := range modelList {
		_, err := db.NewCreateTable().Model(m).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}

	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
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

// The full migration chain must apply cleanly on a fresh database and be
// idempotent on re-run: every self-hosted upgrade and fresh install depends
// on it. Individual historical migrations are covered by this chain run, not
// by per-migration DDL pins.
func TestMigrationChainAppliesCleanlyAndIsIdempotent(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	applied, err := db.NewSelect().Model((*SchemaMigration)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Positive(t, applied, "the chain must record applied migrations")
	for _, table := range []string{
		"workspaces",
		"users",
		"social_accounts",
		"publications",
		"jobs",
	} {
		exists, err := migrationTableExists(ctx, db, table)
		require.NoError(t, err)
		require.True(t, exists, "expected chain to create %s", table)
	}
}

func TestMigrationChainAppliesCleanlyOnPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	schema := fmt.Sprintf("migration_chain_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)

	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))

	applied, err := db.NewSelect().Model((*SchemaMigration)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Positive(t, applied, "the chain must record applied migrations")
}

// isDuplicateColumnMigrationError keeps already-applied DDL idempotent during
// upgrades; misclassifying a dialect error would either replay DDL or abort
// the chain, so both dialect signatures are pinned.
func TestDuplicateColumnMigrationErrorMatchesSQLiteAndPostgres(t *testing.T) {
	t.Parallel()

	require.True(t, isDuplicateColumnMigrationError(
		"ALTER TABLE posts ADD COLUMN publication_id TEXT",
		errors.New("duplicate column name: publication_id"),
	))
	require.True(t, isDuplicateColumnMigrationError(
		"ALTER TABLE posts ADD COLUMN publication_id TEXT",
		errors.New(`pq: column "publication_id" of relation "posts" already exists`),
	))
	require.False(t, isDuplicateColumnMigrationError(
		"CREATE TABLE publications (id TEXT PRIMARY KEY)",
		errors.New("table publications already exists"),
	))
}

func runMigrationsThrough(t *testing.T, db *bun.DB, maximum int64) {
	t.Helper()
	ctx := context.Background()
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	var applied []SchemaMigration
	require.NoError(t, db.NewSelect().Model(&applied).Order("version ASC").Scan(ctx))
	appliedSet := make(map[int64]bool, len(applied))
	for _, item := range applied {
		appliedSet[item.Version] = true
	}
	entries, err := migrationFiles.ReadDir(".")
	require.NoError(t, err)
	migrations := []migration{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, parseErr := parseVersion(entry.Name())
		require.NoError(t, parseErr)
		if version > maximum {
			continue
		}
		content, readErr := migrationFiles.ReadFile(entry.Name())
		require.NoError(t, readErr)
		migrations = append(migrations, migration{
			version: version,
			name:    entry.Name(),
			sql:     normalizeMigrationSQL(db.Dialect().Name(), string(content)),
		})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
	for _, item := range migrations {
		if appliedSet[item.version] {
			continue
		}
		require.NoError(t, prepareMigration(ctx, db, item), item.name)
		require.NoError(t, runMigration(ctx, db, item), item.name)
		appliedSet[item.version] = true
	}
}

func explainSQLiteQueryPlan(t *testing.T, db *bun.DB, query string) string {
	t.Helper()
	type planRow struct {
		ID      int    `bun:"id"`
		Parent  int    `bun:"parent"`
		NotUsed int    `bun:"notused"`
		Detail  string `bun:"detail"`
	}
	var rows []planRow
	require.NoError(t, db.NewRaw("EXPLAIN QUERY PLAN "+query).Scan(t.Context(), &rows))
	details := make([]string, 0, len(rows))
	for _, row := range rows {
		details = append(details, row.Detail)
	}
	return strings.Join(details, "\n")
}

func explainPostgresQueryPlan(t *testing.T, db *bun.DB, query string) string {
	t.Helper()
	var rows []string
	require.NoError(t, db.NewRaw("EXPLAIN (COSTS OFF) "+query).Scan(t.Context(), &rows))
	return strings.Join(rows, "\n")
}
