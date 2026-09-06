package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

type revisionMediaBackfillStats struct {
	Processed     int
	Batches       int
	Failed        int
	RejectedMedia int
	Deferred      bool
}

type revisionMediaBackfillBatchResult struct {
	Processed     int
	Failed        int
	RejectedMedia int
	LastID        string
}

type revisionMediaBackfillBatchFunc func(
	context.Context,
	*bun.DB,
	int,
	string,
) (revisionMediaBackfillBatchResult, error)

func backfillRevisionMediaReferencesWithLimit(
	ctx context.Context,
	db *bun.DB,
	requiredTables []string,
	batchSize int,
	maxBatches int,
	backfillBatch revisionMediaBackfillBatchFunc,
) (revisionMediaBackfillStats, error) {
	var stats revisionMediaBackfillStats
	ready, err := migrationTablesExist(ctx, db, requiredTables...)
	if err != nil || !ready {
		return stats, err
	}
	if batchSize <= 0 {
		batchSize = revisionMediaBackfillBatchSize
	}
	if maxBatches <= 0 {
		maxBatches = 1
	}
	cursor := ""
	for stats.Batches < maxBatches {
		batch, batchErr := backfillBatch(ctx, db, batchSize, cursor)
		if batchErr != nil {
			return stats, batchErr
		}
		if batch.Processed == 0 {
			return stats, nil
		}
		stats.Processed += batch.Processed
		stats.Failed += batch.Failed
		stats.RejectedMedia += batch.RejectedMedia
		stats.Batches++
		cursor = batch.LastID
	}
	stats.Deferred = true
	return stats, nil
}

// AdvanceWorkspaceEditorRevisionMediaBackfill moves one bounded design batch
// for the workspace being cleaned. Keeping this path scoped prevents a large
// workspace from blocking another workspace's cleanup, while startup continues
// to advance the global backlog separately.
func AdvanceWorkspaceEditorRevisionMediaBackfill(
	ctx context.Context,
	db *bun.DB,
	workspaceID string,
) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return fmt.Errorf("workspace_id is required for revision media indexing")
	}
	_, err := backfillDesignRevisionMediaReferencesBatchAfterWorkspace(
		ctx,
		db,
		revisionMediaBackfillBatchSize,
		"",
		workspaceID,
	)
	return err
}

// WorkspaceEditorRevisionMediaBackfillPending reports whether media cleanup
// must stay fail-closed for a workspace. Invalid snapshots count as processed:
// they have durable sanitized markers and are intentionally non-restorable.
func WorkspaceEditorRevisionMediaBackfillPending(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
) (bool, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return false, fmt.Errorf("workspace_id is required for revision media indexing")
	}
	var pending bool
	err := db.NewRaw(`
		SELECT EXISTS (
			SELECT 1
			FROM design_revisions revision
			JOIN design_documents document ON document.id = revision.design_document_id
			LEFT JOIN design_revision_media_index_state state ON state.revision_id = revision.id
			WHERE document.workspace_id = ? AND state.revision_id IS NULL
		) AS pending
	`, workspaceID).Scan(ctx, &pending)
	return pending, err
}
