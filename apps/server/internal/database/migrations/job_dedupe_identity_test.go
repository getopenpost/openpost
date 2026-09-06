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
