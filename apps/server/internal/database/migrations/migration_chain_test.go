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
	"testing/fstest"
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

	createMigrationBaseTables(t, db)

	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

// createMigrationBaseTables mirrors production startup (CreateSchema creates
// model tables before RunMigrations): historical migrations alter tables
// that only exist because the base schema created them.
func createMigrationBaseTables(t *testing.T, db *bun.DB) {
	t.Helper()
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
		"video_projects",
		"video_project_revisions",
		"video_project_mutations",
		"video_project_conflicts",
		"video_project_checkpoints",
		"project_assets",
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
	createMigrationBaseTables(t, db)

	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))

	applied, err := db.NewSelect().Model((*SchemaMigration)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Positive(t, applied, "the chain must record applied migrations")
}

func TestMultiStageRepostMigrationPreservesLegacyExecutions(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := t.Context()
	for _, model := range []any{
		(*models.Job)(nil),
		(*models.AnalyticsAccountSnapshot)(nil),
		(*models.AnalyticsRenditionSnapshot)(nil),
		(*models.AnalyticsSyncState)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}

	beforeMultiStage := fstest.MapFS{}
	entries, err := migrationFiles.ReadDir(".")
	require.NoError(t, err)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, parseErr := parseVersion(entry.Name())
		require.NoError(t, parseErr)
		if version >= 132 {
			continue
		}
		contents, readErr := migrationFiles.ReadFile(entry.Name())
		require.NoError(t, readErr)
		beforeMultiStage[entry.Name()] = &fstest.MapFile{Data: contents}
	}
	require.NoError(t, runMigrations(db, beforeMultiStage))

	seedMigrationUser(ctx, t, db)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Legacy"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO repost_policies (
		id, workspace_id, name, enabled, delay_seconds, evaluation_window_seconds,
		threshold_mode, created_by, updated_by
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"policy-1", "workspace-1", "Legacy policy", true, 3600, 86400, "all", "user-1", "user-1")
	require.NoError(t, err)
	source := &models.SocialAccount{ID: "source-1", WorkspaceID: "workspace-1", Slug: "source", Platform: "x", AccountID: "source-provider", AccessTokenEnc: []byte("token"), IsActive: true}
	target := &models.SocialAccount{ID: "target-1", WorkspaceID: "workspace-1", Slug: "target", Platform: "x", AccountID: "target-provider", AccessTokenEnc: []byte("token"), IsActive: true}
	_, err = db.NewInsert().Model(source).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(target).Exec(ctx)
	require.NoError(t, err)
	publication := &models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Intent: models.PublishingIntentPost, ContentProfile: models.ContentProfileShortText,
		SourceContent: "Legacy post", Status: models.PublicationStatusPublished,
	}
	_, err = db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: source.ID,
		TargetKey: "x:source-provider", Platform: "x", Profile: models.ContentProfileShortText,
		Status: models.RenditionStatusPublished, ExternalID: "source-post-1",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO repost_executions (
		id, workspace_id, publication_id, rendition_id, source_account_id, target_account_id,
		policy_id, rule_snapshot_json, status, eligible_after, deadline_at, external_id
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"execution-1", "workspace-1", publication.ID, "rendition-1", source.ID, target.ID,
		"policy-1", `{"rule":{"delay_seconds":3600,"evaluation_window_seconds":86400,"threshold_mode":"all","plateau_checks":2}}`,
		"succeeded", time.Now().UTC(), time.Now().UTC().Add(24*time.Hour), "legacy-repost-1")
	require.NoError(t, err)

	multiStageSQL, err := migrationFiles.ReadFile("132_multi_stage_reposts.sql")
	require.NoError(t, err)
	require.NoError(t, runMigrations(db, fstest.MapFS{
		"132_multi_stage_reposts.sql": &fstest.MapFile{Data: multiStageSQL},
	}))

	var stagesJSON string
	err = db.NewSelect().Table("repost_policies").Column("stages_json").Where("id = ?", "policy-1").Scan(ctx, &stagesJSON)
	require.NoError(t, err)
	require.Equal(t, "[]", stagesJSON)

	var legacyExecution struct {
		CurrentStage     int    `bun:"current_stage"`
		TotalStages      int    `bun:"total_stages"`
		UnrepostAttempts int    `bun:"unrepost_attempts"`
		StageHistoryJSON string `bun:"stage_history_json"`
		ExternalID       string `bun:"external_id"`
	}
	err = db.NewSelect().Table("repost_executions").
		Column("current_stage", "total_stages", "unrepost_attempts", "stage_history_json", "external_id").
		Where("id = ?", "execution-1").Scan(ctx, &legacyExecution)
	require.NoError(t, err)
	require.Equal(t, 1, legacyExecution.CurrentStage)
	require.Equal(t, 1, legacyExecution.TotalStages)
	require.Zero(t, legacyExecution.UnrepostAttempts)
	require.Equal(t, "[]", legacyExecution.StageHistoryJSON)
	require.Equal(t, "legacy-repost-1", legacyExecution.ExternalID)

	for _, column := range []string{"current_stage", "total_stages", "unrepost_attempts", "stage_history_json"} {
		exists, columnErr := migrationColumnExists(ctx, db, "repost_executions", column)
		require.NoError(t, columnErr)
		require.True(t, exists, "expected repost_executions.%s", column)
	}
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

const migrationChainTestMaximumVersion = 7

func runMigrationsThrough(t *testing.T, db *bun.DB) {
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
		if version > migrationChainTestMaximumVersion {
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
