package migrations

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
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
		(*models.AnalyticsAccountSnapshot)(nil),
		(*models.AnalyticsRenditionSnapshot)(nil),
		(*models.AnalyticsSyncState)(nil),
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

func TestSourceEditingDesignMigrationAllowsReplacementAfterTrash(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "source-workspace", Name: "Source editing"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "source-user", Email: "source@example.com"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{ID: "source-media", WorkspaceID: "source-workspace", FilePath: "source.png", MimeType: "image/png", FileHash: "source-hash", AssetKind: "library"}).Exec(t.Context())
	require.NoError(t, err)
	design := &models.DesignDocument{ID: "first-source-design", WorkspaceID: "source-workspace", CreatedByID: "source-user", Title: "Source", WidthPX: 1080, HeightPX: 1080, SourceMediaID: "source-media"}
	_, err = db.NewInsert().Model(design).Exec(t.Context())
	require.NoError(t, err)
	design.ID = "replacement-source-design"
	_, err = db.NewInsert().Model(design).Exec(t.Context())
	require.Error(t, err)
	_, err = db.Exec("UPDATE design_documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'first-source-design'")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(design).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.Exec("DELETE FROM media_attachments WHERE id = 'source-media'")
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.DesignDocument)(nil)).Where("source_media_id IS NOT NULL").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestProfileFetchedAtMigration(t *testing.T) {
	t.Parallel()
	exerciseProfileFetchedAtMigration(t, newMigrationsTestDB(t))
}
func TestProfileFetchedAtMigrationPostgres(t *testing.T) {
	t.Parallel()
	exerciseProfileFetchedAtMigration(t, newPostgresMigrationTestDB(t))
}
func exerciseProfileFetchedAtMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	require.NoError(t, RunMigrations(db))
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspaces(id,name) VALUES('profile-ws','Profile')`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted) VALUES('profile-account','profile-ws','profile','youtube','channel','Existing',?)`, []byte{0})
	require.NoError(t, err)
	var unknown bool
	var name string
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT profile_fetched_at IS NULL,account_username FROM social_accounts WHERE id='profile-account'`).Scan(&unknown, &name))
	require.True(t, unknown, "migrations must not invent a successful fetch date")
	require.Equal(t, "Existing", name)
	fetched := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	_, err = db.ExecContext(t.Context(), `UPDATE social_accounts SET profile_fetched_at=? WHERE id='profile-account'`, fetched)
	require.NoError(t, err)
	var got time.Time
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT profile_fetched_at FROM social_accounts WHERE id='profile-account'`).Scan(&got))
	require.Equal(t, fetched, got.UTC())
}

func TestLegacyPublicationJobRewriteAcceptsNullPayload(t *testing.T) {
	t.Parallel()
	for _, payload := range []string{"null", "{}", `{"post_id":"legacy-post","custom":"preserved"}`} {
		t.Run(payload, func(t *testing.T) {
			db := newMigrationsTestDB(t)
			createLegacyPublicationTestTables(t, db)
			_, err := db.NewInsert().Model(&models.Post{ID: "legacy-post", WorkspaceID: "workspace", Status: models.PostStatusScheduled}).Exec(t.Context())
			require.NoError(t, err)
			runAt := time.Now().UTC().Truncate(time.Second)
			_, err = db.NewInsert().Model(&models.Job{ID: "legacy-job", Type: jobregistry.TypePublishPost, ScopeID: "legacy-post", Status: jobregistry.StatusPending, Payload: payload, RunAt: runAt, MaxAttempts: 3}).Exec(t.Context())
			require.NoError(t, err)
			require.NotPanics(t, func() {
				require.NoError(t, rewriteLegacyPublicationJobs(t.Context(), db, "legacy-post", "publication"))
			})
			var job models.Job
			require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "legacy-job").Scan(t.Context()))
			require.Equal(t, jobregistry.TypePublishPublication, job.Type)
			require.Equal(t, "publication", job.ScopeID)
			require.Equal(t, jobregistry.StatusPending, job.Status)
			require.True(t, runAt.Equal(job.RunAt))
			var saved map[string]any
			require.NoError(t, json.Unmarshal([]byte(job.Payload), &saved))
			require.Equal(t, "publication", saved["publication_id"])
			require.NotContains(t, saved, "post_id")
			if payload != "null" && payload != "{}" {
				require.Equal(t, "preserved", saved["custom"])
			}
		})
	}
}

func TestJobDedupeIdentityMigrationBackfillsAndCollapsesActiveCleanupJobs(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewCreateTable().Model((*models.Job)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Job{
		{ID: "processing", Type: jobregistry.TypeMediaCleanup, Payload: `{"workspace_id":"workspace-1","days":14}`, Status: jobregistry.StatusProcessing, RunAt: time.Now().UTC(), LockedAt: time.Now().UTC(), LockedBy: "dead-worker"},
		{ID: "pending", Type: jobregistry.TypeMediaCleanup, Payload: `{"workspace_id":"workspace-1","days":14}`, Status: jobregistry.StatusPending, RunAt: time.Now().UTC().Add(time.Hour)},
		{ID: "history", Type: jobregistry.TypeMediaCleanup, Payload: `{"workspace_id":"workspace-1","days":14}`, Status: jobregistry.StatusCompleted, RunAt: time.Now().UTC().Add(-time.Hour)},
		{ID: "other", Type: jobregistry.TypeMediaCleanup, Payload: `{"workspace_id":"workspace-10","days":14}`, Status: jobregistry.StatusPending, RunAt: time.Now().UTC()},
	}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, backfillJobDedupeIdentities(ctx, db))

	var rows []models.Job
	require.NoError(t, db.NewSelect().Model(&rows).Order("id ASC").Scan(ctx))
	byID := make(map[string]models.Job, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
		require.NotEmpty(t, row.ScopeID)
		require.Equal(t, "daily", row.DedupeKey)
	}
	require.Equal(t, jobregistry.StatusProcessing, byID["processing"].Status)
	require.Equal(t, jobregistry.StatusCompleted, byID["pending"].Status)
	require.Contains(t, byID["pending"].LastError, "processing")
	require.Equal(t, "workspace-1", byID["history"].ScopeID)
	require.Equal(t, "workspace-10", byID["other"].ScopeID)
}
