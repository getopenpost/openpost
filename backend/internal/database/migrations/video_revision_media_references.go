package migrations

import (
	"context"
	"log"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type videoRevisionMediaBackfillStats = revisionMediaBackfillStats

type videoRevisionMediaBackfillBatchResult = revisionMediaBackfillBatchResult

func backfillVideoRevisionMediaReferences(ctx context.Context, db *bun.DB) error {
	stats, err := backfillVideoRevisionMediaReferencesWithStats(
		ctx,
		db,
		revisionMediaBackfillBatchSize,
	)
	if stats.Processed > 0 {
		log.Printf(
			"indexed media ownership for %d video revisions in %d batches (%d invalid snapshots, %d missing or rejected media references, deferred=%t)",
			stats.Processed,
			stats.Batches,
			stats.Failed,
			stats.RejectedMedia,
			stats.Deferred,
		)
	}
	return err
}

func backfillVideoRevisionMediaReferencesWithStats(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
) (videoRevisionMediaBackfillStats, error) {
	return backfillVideoRevisionMediaReferencesWithLimit(
		ctx,
		db,
		batchSize,
		revisionMediaBackfillMaxBatchesPerStartup,
	)
}

func backfillVideoRevisionMediaReferencesWithLimit(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
	maxBatches int,
) (videoRevisionMediaBackfillStats, error) {
	return backfillRevisionMediaReferencesWithLimit(
		ctx,
		db,
		[]string{
			"video_projects",
			"video_project_revisions",
			"video_project_assets",
			"media_attachments",
			"video_revision_media_index_state",
		},
		batchSize,
		maxBatches,
		backfillVideoRevisionMediaReferencesBatchAfter,
	)
}

func backfillVideoRevisionMediaReferencesBatch(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
) (videoRevisionMediaBackfillBatchResult, error) {
	return backfillVideoRevisionMediaReferencesBatchAfter(ctx, db, batchSize, "")
}

func backfillVideoRevisionMediaReferencesBatchAfter(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
	afterID string,
) (videoRevisionMediaBackfillBatchResult, error) {
	return backfillVideoRevisionMediaReferencesBatchAfterWorkspace(
		ctx,
		db,
		batchSize,
		afterID,
		"",
	)
}

func backfillVideoRevisionMediaReferencesBatchAfterWorkspace(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
	afterID string,
	workspaceID string,
) (videoRevisionMediaBackfillBatchResult, error) {
	var result videoRevisionMediaBackfillBatchResult
	if batchSize <= 0 {
		batchSize = revisionMediaBackfillBatchSize
	}
	err := db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		var revisions []struct {
			ID             string `bun:"id"`
			VideoProjectID string `bun:"video_project_id"`
			WorkspaceID    string `bun:"workspace_id"`
			Snapshot       []byte `bun:"snapshot"`
		}
		query := tx.NewSelect().
			TableExpr("video_project_revisions AS revision").
			ColumnExpr("revision.id, revision.video_project_id, revision.snapshot, project.workspace_id").
			Join("JOIN video_projects AS project ON project.id = revision.video_project_id").
			Where("NOT EXISTS (SELECT 1 FROM video_revision_media_index_state state WHERE state.revision_id = revision.id)").
			OrderExpr("revision.id ASC").
			Limit(batchSize)
		if afterID != "" {
			query = query.Where("revision.id > ?", afterID)
		}
		if workspaceID != "" {
			query = query.Where("project.workspace_id = ?", workspaceID)
		}
		if err := query.Scan(txCtx, &revisions); err != nil {
			return err
		}
		if len(revisions) > 0 {
			result.LastID = revisions[len(revisions)-1].ID
		}
		for _, revision := range revisions {
			if err := txCtx.Err(); err != nil {
				return err
			}
			mediaIDs, err := designRevisionSnapshotMediaIDs(revision.Snapshot)
			if err != nil {
				state := &models.VideoRevisionMediaIndexState{
					RevisionID:  revision.ID,
					Status:      "invalid",
					FailureCode: designRevisionSnapshotFailureCode(err),
				}
				if _, insertErr := tx.NewInsert().Model(state).
					On("CONFLICT (revision_id) DO NOTHING").
					Exec(txCtx); insertErr != nil {
					return insertErr
				}
				result.Processed++
				result.Failed++
				continue
			}
			existingIDs, err := existingWorkspaceMediaIDs(
				txCtx,
				tx,
				revision.WorkspaceID,
				mediaIDs,
			)
			if err != nil {
				return err
			}
			if len(existingIDs) > 0 {
				usage := "revision:" + revision.ID
				assets := make([]models.VideoProjectAsset, 0, len(existingIDs))
				for _, mediaID := range existingIDs {
					assets = append(assets, models.VideoProjectAsset{
						VideoProjectID: revision.VideoProjectID,
						SourceID:       usage + ":backfill:" + mediaID,
						RevisionID:     revision.ID,
						MediaID:        mediaID,
						Usage:          usage,
					})
				}
				if err := insertVideoRevisionMediaAssets(txCtx, tx, assets); err != nil {
					return err
				}
			}
			state := &models.VideoRevisionMediaIndexState{
				RevisionID:        revision.ID,
				MediaCount:        len(existingIDs),
				MissingMediaCount: len(mediaIDs) - len(existingIDs),
				Status:            "complete",
			}
			if _, err := tx.NewInsert().Model(state).
				On("CONFLICT (revision_id) DO NOTHING").
				Exec(txCtx); err != nil {
				return err
			}
			result.Processed++
			result.RejectedMedia += state.MissingMediaCount
		}
		return nil
	})
	return result, err
}

func insertVideoRevisionMediaAssets(
	ctx context.Context,
	db bun.IDB,
	assets []models.VideoProjectAsset,
) error {
	for start := 0; start < len(assets); start += revisionMediaReferenceChunkSize {
		end := min(start+revisionMediaReferenceChunkSize, len(assets))
		chunk := assets[start:end]
		if _, err := db.NewInsert().Model(&chunk).
			On("CONFLICT (video_project_id, source_id) DO UPDATE").
			Set("revision_id = EXCLUDED.revision_id").
			Set("media_id = EXCLUDED.media_id").
			Set("usage = EXCLUDED.usage").
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
