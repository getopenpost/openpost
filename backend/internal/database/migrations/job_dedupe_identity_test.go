package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

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

func TestJobDedupeIdentityMigrationUpgradesPopulatedLegacySQLiteTable(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		CREATE TABLE jobs (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			payload TEXT NOT NULL,
			status TEXT DEFAULT 'pending',
			run_at TIMESTAMP NOT NULL,
			attempts INTEGER DEFAULT 0,
			max_attempts INTEGER DEFAULT 3,
			last_error TEXT,
			locked_at TIMESTAMP,
			locked_by TEXT
		);
		INSERT INTO jobs (id, type, payload, status, run_at) VALUES
			('first', 'media_cleanup', '{"workspace_id":"workspace-1","days":14}', 'pending', current_timestamp),
			('duplicate', 'media_cleanup', '{"workspace_id":"workspace-1","days":14}', 'pending', current_timestamp),
			('history', 'media_cleanup', '{"workspace_id":"workspace-1","days":14}', 'completed', current_timestamp);
	`)
	require.NoError(t, err)

	sqlBytes, err := migrationFiles.ReadFile("071_job_dedupe_identity.sql")
	require.NoError(t, err)
	require.NoError(t, runMigration(ctx, db, migration{
		version: 71,
		name:    "071_job_dedupe_identity.sql",
		sql:     string(sqlBytes),
	}))
	require.NoError(t, backfillJobDedupeIdentities(ctx, db))

	active, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("scope_id = ? AND dedupe_key = ?", "workspace-1", "daily").
		Where("status IN (?, ?)", jobregistry.StatusPending, jobregistry.StatusProcessing).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, active)

	_, err = db.NewInsert().Model(&models.Job{
		ID: "conflict", Type: jobregistry.TypeMediaCleanup,
		ScopeID: "workspace-1", DedupeKey: "daily",
		Payload: `{"workspace_id":"workspace-1","days":14}`,
		Status:  jobregistry.StatusPending, RunAt: time.Now().UTC(),
	}).Exec(ctx)
	require.Error(t, err)
}
