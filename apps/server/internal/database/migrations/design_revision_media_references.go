package migrations

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"sort"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const revisionSnapshotBackfillLimit = (10 << 20) + (64 << 10)
const revisionMediaBackfillBatchSize = 100
const revisionMediaBackfillMaxBatchesPerStartup = 8
const revisionMediaReferenceChunkSize = 200

func ensureDesignRevisionMediaReferenceSchema(ctx context.Context, db *bun.DB) error {
	designReady, err := migrationTablesExist(
		ctx,
		db,
		"design_documents",
		"design_revisions",
		"media_attachments",
	)
	if err != nil {
		return err
	}
	if designReady {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS design_revision_media_references (
			revision_id TEXT NOT NULL,
			media_id TEXT NOT NULL,
			usage TEXT NOT NULL DEFAULT 'snapshot',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (revision_id, media_id),
			FOREIGN KEY (revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE,
			FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
		)`,
			`CREATE INDEX IF NOT EXISTS design_revision_media_references_media_idx
			ON design_revision_media_references (media_id)`,
			`CREATE TABLE IF NOT EXISTS design_revision_media_index_state (
			revision_id TEXT PRIMARY KEY,
			media_count INTEGER NOT NULL DEFAULT 0,
			missing_media_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'complete',
			failure_code TEXT NOT NULL DEFAULT '',
			processed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			FOREIGN KEY (revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
			)`,
		}
		for _, statement := range statements {
			if _, err := db.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
	}
	return nil
}

func migrationTablesExist(ctx context.Context, db *bun.DB, tables ...string) (bool, error) {
	for _, table := range tables {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil || !exists {
			return false, err
		}
	}
	return true, nil
}

func backfillDesignRevisionMediaReferences(ctx context.Context, db *bun.DB) error {
	stats, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, revisionMediaBackfillBatchSize)
	if stats.Processed > 0 {
		log.Printf(
			"indexed media ownership for %d design revisions in %d batches (%d invalid snapshots, %d missing or rejected media references, deferred=%t)",
			stats.Processed,
			stats.Batches,
			stats.Failed,
			stats.RejectedMedia,
			stats.Deferred,
		)
	}
	return err
}

type designRevisionMediaBackfillStats = revisionMediaBackfillStats

type designRevisionMediaBackfillBatchResult = revisionMediaBackfillBatchResult

func backfillDesignRevisionMediaReferencesWithStats(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
) (designRevisionMediaBackfillStats, error) {
	return backfillDesignRevisionMediaReferencesWithLimit(
		ctx,
		db,
		batchSize,
		revisionMediaBackfillMaxBatchesPerStartup,
	)
}

func backfillDesignRevisionMediaReferencesWithLimit(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
	maxBatches int,
) (designRevisionMediaBackfillStats, error) {
	return backfillRevisionMediaReferencesWithLimit(
		ctx,
		db,
		[]string{
			"design_documents",
			"design_revisions",
			"media_attachments",
			"design_revision_media_references",
			"design_revision_media_index_state",
		},
		batchSize,
		maxBatches,
		backfillDesignRevisionMediaReferencesBatchAfter,
	)
}

func backfillDesignRevisionMediaReferencesBatch(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
) (designRevisionMediaBackfillBatchResult, error) {
	return backfillDesignRevisionMediaReferencesBatchAfter(ctx, db, batchSize, "")
}

func backfillDesignRevisionMediaReferencesBatchAfter(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
	afterID string,
) (designRevisionMediaBackfillBatchResult, error) {
	return backfillDesignRevisionMediaReferencesBatchAfterWorkspace(
		ctx,
		db,
		batchSize,
		afterID,
		"",
	)
}

func backfillDesignRevisionMediaReferencesBatchAfterWorkspace(
	ctx context.Context,
	db *bun.DB,
	batchSize int,
	afterID string,
	workspaceID string,
) (designRevisionMediaBackfillBatchResult, error) {
	var result designRevisionMediaBackfillBatchResult
	if batchSize <= 0 {
		batchSize = revisionMediaBackfillBatchSize
	}
	err := db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		var revisions []struct {
			ID          string `bun:"id"`
			WorkspaceID string `bun:"workspace_id"`
			Snapshot    []byte `bun:"snapshot"`
		}
		query := tx.NewSelect().
			TableExpr("design_revisions AS revision").
			ColumnExpr("revision.id, revision.snapshot, document.workspace_id").
			Join("JOIN design_documents AS document ON document.id = revision.design_document_id").
			Where("NOT EXISTS (SELECT 1 FROM design_revision_media_index_state state WHERE state.revision_id = revision.id)").
			OrderExpr("revision.id ASC").
			Limit(batchSize)
		if afterID != "" {
			query = query.Where("revision.id > ?", afterID)
		}
		if workspaceID != "" {
			query = query.Where("document.workspace_id = ?", workspaceID)
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
				state := &models.DesignRevisionMediaIndexState{
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
				refs := make([]models.DesignRevisionMediaReference, 0, len(existingIDs))
				for _, mediaID := range existingIDs {
					refs = append(refs, models.DesignRevisionMediaReference{
						RevisionID: revision.ID,
						MediaID:    mediaID,
						Usage:      "snapshot",
					})
				}
				if err := insertDesignRevisionMediaReferences(txCtx, tx, refs); err != nil {
					return err
				}
			}
			state := &models.DesignRevisionMediaIndexState{
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

func existingWorkspaceMediaIDs(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
	mediaIDs []string,
) ([]string, error) {
	existing := make([]string, 0, len(mediaIDs))
	for start := 0; start < len(mediaIDs); start += revisionMediaReferenceChunkSize {
		end := min(start+revisionMediaReferenceChunkSize, len(mediaIDs))
		var chunk []string
		if err := db.NewSelect().Model((*models.MediaAttachment)(nil)).
			Column("id").
			Where("workspace_id = ?", workspaceID).
			Where("id IN (?)", bun.List(mediaIDs[start:end])).
			Scan(ctx, &chunk); err != nil {
			return nil, err
		}
		existing = append(existing, chunk...)
	}
	sort.Strings(existing)
	return existing, nil
}

func insertDesignRevisionMediaReferences(
	ctx context.Context,
	db bun.IDB,
	references []models.DesignRevisionMediaReference,
) error {
	for start := 0; start < len(references); start += revisionMediaReferenceChunkSize {
		end := min(start+revisionMediaReferenceChunkSize, len(references))
		chunk := references[start:end]
		if _, err := db.NewInsert().Model(&chunk).
			On("CONFLICT (revision_id, media_id) DO NOTHING").
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

type designRevisionSnapshotIndexError struct {
	code string
	err  error
}

func (err designRevisionSnapshotIndexError) Error() string { return err.err.Error() }
func (err designRevisionSnapshotIndexError) Unwrap() error { return err.err }

func designRevisionSnapshotFailureCode(err error) string {
	var snapshotErr designRevisionSnapshotIndexError
	if errors.As(err, &snapshotErr) {
		return snapshotErr.code
	}
	return "invalid_snapshot"
}

func designRevisionSnapshotMediaIDs(compressed []byte) ([]string, error) {
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, designRevisionSnapshotIndexError{code: "invalid_compression", err: err}
	}
	defer reader.Close() //nolint:errcheck
	data, err := io.ReadAll(io.LimitReader(reader, revisionSnapshotBackfillLimit+1))
	if err != nil {
		return nil, designRevisionSnapshotIndexError{code: "read_failed", err: err}
	}
	if len(data) > revisionSnapshotBackfillLimit {
		return nil, designRevisionSnapshotIndexError{code: "too_large", err: fmt.Errorf("snapshot exceeds the backfill limit")}
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, designRevisionSnapshotIndexError{code: "invalid_json", err: err}
	}
	mediaIDs := make(map[string]struct{})
	collectDesignRevisionSnapshotMediaIDs(decoded, mediaIDs)
	result := make([]string, 0, len(mediaIDs))
	for mediaID := range mediaIDs {
		result = append(result, mediaID)
	}
	sort.Strings(result)
	return result, nil
}

func collectDesignRevisionSnapshotMediaIDs(value any, mediaIDs map[string]struct{}) {
	switch value := value.(type) {
	case []any:
		for _, item := range value {
			collectDesignRevisionSnapshotMediaIDs(item, mediaIDs)
		}
	case map[string]any:
		for key, item := range value {
			if designRevisionMediaIDKey(key) {
				if mediaID, ok := item.(string); ok && strings.TrimSpace(mediaID) != "" {
					mediaIDs[strings.TrimSpace(mediaID)] = struct{}{}
				}
			}
			collectDesignRevisionSnapshotMediaIDs(item, mediaIDs)
		}
	}
}

func designRevisionMediaIDKey(key string) bool {
	switch key {
	case "media_id", "font_asset_id", "preview_media_id", "latest_export_media_id", "cover_preview_media_id":
		return true
	default:
		return false
	}
}
