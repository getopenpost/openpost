package testdb

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

var (
	sqliteTemplateOnce  sync.Once
	sqliteTemplateBytes []byte
	sqliteTemplateErr   error

	sqliteBaseOnce  sync.Once
	sqliteBaseBytes []byte
	sqliteBaseErr   error
)

func loadSQLiteTemplate() ([]byte, error) {
	sqliteTemplateOnce.Do(func() {
		dir, err := os.MkdirTemp("", "openpost-testdb-template-")
		if err != nil {
			sqliteTemplateErr = fmt.Errorf("create template dir: %w", err)
			return
		}
		defer func() { _ = os.RemoveAll(dir) }()

		templatePath := filepath.Join(dir, "template.db")
		dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(templatePath), RawQuery: "mode=rwc"}
		db, err := database.InitDBWithDriverAndRole("sqlite", dsn.String(), "all")
		if err != nil {
			sqliteTemplateErr = fmt.Errorf("init template db: %w", err)
			return
		}
		if err := database.CreateSchema(db); err != nil {
			_ = db.Close()
			sqliteTemplateErr = fmt.Errorf("create template schema: %w", err)
			return
		}
		// Flush WAL into the main database file so cloning is a single file write.
		_, _ = db.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
		_, _ = db.Exec("PRAGMA journal_mode=DELETE;")
		if err := db.Close(); err != nil {
			sqliteTemplateErr = fmt.Errorf("close template db: %w", err)
			return
		}
		data, err := os.ReadFile(templatePath)
		if err != nil {
			sqliteTemplateErr = fmt.Errorf("read template db: %w", err)
			return
		}
		sqliteTemplateBytes = data
	})
	return sqliteTemplateBytes, sqliteTemplateErr
}

func loadSQLiteBaseTemplate() ([]byte, error) {
	sqliteBaseOnce.Do(func() {
		dir, err := os.MkdirTemp("", "openpost-testdb-base-")
		if err != nil {
			sqliteBaseErr = fmt.Errorf("create base template dir: %w", err)
			return
		}
		defer func() { _ = os.RemoveAll(dir) }()

		templatePath := filepath.Join(dir, "base.db")
		sqldb, err := sql.Open(sqliteshim.ShimName, "file:"+filepath.ToSlash(templatePath)+"?mode=rwc")
		if err != nil {
			sqliteBaseErr = fmt.Errorf("open base template db: %w", err)
			return
		}
		sqldb.SetMaxOpenConns(1)
		db := bun.NewDB(sqldb, sqlitedialect.New())

		ctx := context.Background()
		baseModels := []any{
			(*models.Organization)(nil),
			(*models.OrganizationMember)(nil),
			(*models.OrganizationInvitation)(nil),
			(*models.Workspace)(nil),
			(*models.User)(nil),
			(*models.WorkspaceMember)(nil),
			(*models.SocialAccount)(nil),
			(*models.OAuthGrant)(nil),
			(*models.DraftRevisionChange)(nil),
			(*models.WorkspaceFirstConnection)(nil),
			(*models.WorkspaceActivation)(nil),
			(*models.ProductAnalyticsEvent)(nil),
			(*models.OAuthAccountSelectionReservation)(nil),
			(*models.Post)(nil),
			(*models.PostDestination)(nil),
			(*models.PostMedia)(nil),
			(*models.PostVariant)(nil),
			(*models.ThreadDraft)(nil),
			(*models.Publication)(nil),
			(*models.PublicationSegment)(nil),
			(*models.PublicationSegmentMedia)(nil),
			(*models.Rendition)(nil),
			(*models.RenditionSegment)(nil),
			(*models.RenditionSegmentMedia)(nil),
			(*models.RenditionMedia)(nil),
			(*models.PublicationLifecycleEvent)(nil),
			(*models.PublicationAuthorization)(nil),
			(*models.ProviderWriteAttempt)(nil),
			(*models.MediaAttachment)(nil),
			(*models.UsageCounter)(nil),
			(*models.ProviderUsageEvent)(nil),
			(*models.ProviderUsageReservation)(nil),
			(*models.ProviderUsagePeriodCounter)(nil),
			(*models.BillingSubscription)(nil),
			(*models.BillingWebhookEvent)(nil),
			(*models.BillingCheckoutAttempt)(nil),
			(*models.BillingCheckoutCancellation)(nil),
			(*models.BillingCustomer)(nil),
			(*models.Job)(nil),
		}
		for _, m := range baseModels {
			if _, err := db.NewCreateTable().Model(m).IfNotExists().Exec(ctx); err != nil {
				_ = db.Close()
				sqliteBaseErr = fmt.Errorf("create base table: %w", err)
				return
			}
		}
		for _, stmt := range []string{
			`CREATE TABLE IF NOT EXISTS voice_profiles (
				id TEXT PRIMARY KEY,
				workspace_id TEXT NOT NULL,
				name TEXT NOT NULL,
				normalized_name TEXT NOT NULL,
				is_default BOOLEAN NOT NULL DEFAULT false,
				revision INTEGER NOT NULL DEFAULT 1,
				schema_version INTEGER NOT NULL DEFAULT 1,
				definition_json TEXT NOT NULL DEFAULT '{}',
				created_by_id TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
				updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
				UNIQUE (id, workspace_id),
				UNIQUE (workspace_id, normalized_name)
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_default_idx ON voice_profiles (workspace_id) WHERE is_default = true`,
			`CREATE TABLE IF NOT EXISTS voice_profile_account_assignments (
				social_account_id TEXT PRIMARY KEY,
				workspace_id TEXT NOT NULL,
				voice_profile_id TEXT NOT NULL,
				created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
				updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
			)`,
		} {
			if _, err := db.ExecContext(ctx, stmt); err != nil {
				_ = db.Close()
				sqliteBaseErr = fmt.Errorf("create base voice table: %w", err)
				return
			}
		}
		if err := db.Close(); err != nil {
			sqliteBaseErr = fmt.Errorf("close base template db: %w", err)
			return
		}
		data, err := os.ReadFile(templatePath)
		if err != nil {
			sqliteBaseErr = fmt.Errorf("read base template db: %w", err)
			return
		}
		sqliteBaseBytes = data
	})
	return sqliteBaseBytes, sqliteBaseErr
}

// Open opens a SQLite database with the default "all" role.
func Open(dsn string) (*bun.DB, error) {
	return database.InitDBWithDriverAndRole("sqlite", dsn, "all")
}

// OpenWithDriver opens a database for the given driver with the default "all" role.
func OpenWithDriver(driver, dsn string) (*bun.DB, error) {
	return database.InitDBWithDriverAndRole(driver, dsn, "all")
}

// NewSQLite returns an isolated SQLite test database cloned from a once-per-process
// migrated schema template. Safe for concurrent t.Parallel() tests.
func NewSQLite(t testing.TB) *bun.DB {
	t.Helper()
	return NewSQLiteAt(t, filepath.Join(t.TempDir(), "test.db"))
}

// NewSQLiteNoFK returns an isolated migrated SQLite test database with foreign-key
// enforcement disabled, for unit tests that seed partial fixtures without parent rows.
func NewSQLiteNoFK(t testing.TB) *bun.DB {
	t.Helper()
	db := NewSQLite(t)
	_, err := db.Exec("PRAGMA foreign_keys=OFF;")
	require.NoError(t, err)
	return db
}

// NewSQLiteBase returns an isolated SQLite test database cloned from a
// once-per-process unmigrated Bun-table template, creating any extraModels
// not already present in the base template.
func NewSQLiteBase(t testing.TB, extraModels ...any) *bun.DB {
	t.Helper()
	template, err := loadSQLiteBaseTemplate()
	require.NoError(t, err)
	testPath := filepath.Join(t.TempDir(), "base.db")
	require.NoError(t, os.WriteFile(testPath, template, 0o600))

	sqldb, err := sql.Open(sqliteshim.ShimName, testPath)
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })

	ctx := context.Background()
	for _, m := range extraModels {
		_, err := db.NewCreateTable().Model(m).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	return db
}

// NewSQLiteAt writes a fresh migrated schema clone to path and opens it.
func NewSQLiteAt(t testing.TB, path string) *bun.DB {
	t.Helper()
	template, err := loadSQLiteTemplate()
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, template, 0o600))

	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: "mode=rwc"}
	db, err := Open(dsn.String())
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}
