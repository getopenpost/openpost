package handlers

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

func (h *ImageEditorHandler) listRevisions(ctx context.Context, input *ListImageEditorRevisionsInput) (*ListImageEditorRevisionsOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, false); err != nil {
		return nil, err
	}
	var revisions []models.DesignRevision
	cursor, err := decodeEditorRevisionCursor(input.Cursor)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid OpenPost Image Editor revision cursor")
	}
	limit := editorRevisionLimit(input.Limit)
	query := h.db.NewSelect().Model(&revisions).
		Where("design_document_id = ?", document.ID).
		OrderExpr("created_at DESC, id DESC").
		Limit(int64(limit + 1))
	if !cursor.CreatedAt.IsZero() {
		query = query.Where(
			"(created_at < ?) OR (created_at = ? AND id < ?)",
			cursor.CreatedAt,
			cursor.CreatedAt,
			cursor.ID,
		)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list OpenPost Image Editor revisions")
	}
	nextCursor := ""
	if len(revisions) > limit {
		next := revisions[limit-1]
		nextCursor = encodeEditorRevisionCursor(next.CreatedAt, next.ID)
		revisions = revisions[:limit]
	}
	actorIDs := make([]string, 0, len(revisions))
	for _, revision := range revisions {
		actorIDs = append(actorIDs, revision.CreatedByID)
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, actorIDs, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision actors")
	}
	out := &ListImageEditorRevisionsOutput{}
	out.Body.NextCursor = nextCursor
	out.Body.Revisions = make([]ImageEditorRevisionSummary, 0, len(revisions))
	for _, revision := range revisions {
		out.Body.Revisions = append(out.Body.Revisions, imageRevisionSummary(
			revision,
			editorRevisionActor(actors, revision.CreatedByID, currentUserID),
		))
	}
	return out, nil
}

func (h *ImageEditorHandler) getRevision(
	ctx context.Context,
	input *GetImageEditorRevisionInput,
) (*GetImageEditorRevisionOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, false); err != nil {
		return nil, err
	}
	revision, snapshot, err := h.loadImageEditorRevisionSnapshot(ctx, h.db, document.ID, input.RevisionID)
	if err != nil {
		return nil, err
	}
	if err := validateImageEditorPayload(snapshot.Document); err != nil {
		return nil, huma.Error400BadRequest("OpenPost Image Editor revision is invalid")
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, []string{revision.CreatedByID}, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision actor")
	}
	return &GetImageEditorRevisionOutput{Body: ImageEditorRevisionResponse{
		Summary: imageRevisionSummary(
			*revision,
			editorRevisionActor(actors, revision.CreatedByID, currentUserID),
		),
		CoverPreviewMediaID: snapshot.CoverPreviewMediaID,
		Document:            snapshot.Document,
	}}, nil
}

func (h *ImageEditorHandler) loadImageEditorRevisionSnapshot(
	ctx context.Context,
	db bun.IDB,
	documentID string,
	revisionID string,
) (*models.DesignRevision, imageEditorRevisionSnapshot, error) {
	var revision models.DesignRevision
	err := db.NewSelect().Model(&revision).
		Where("id = ? AND design_document_id = ?", revisionID, documentID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, imageEditorRevisionSnapshot{}, huma.Error404NotFound("OpenPost Image Editor revision not found")
	}
	if err != nil {
		return nil, imageEditorRevisionSnapshot{}, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision")
	}
	snapshot, err := decompressImageEditorSnapshot(revision.Snapshot)
	if err != nil {
		return nil, imageEditorRevisionSnapshot{}, huma.Error400BadRequest("OpenPost Image Editor revision is corrupt")
	}
	return &revision, snapshot, nil
}

func (h *ImageEditorHandler) deleteRevision(ctx context.Context, input *DeleteImageEditorRevisionInput) (*DeleteImageEditorRevisionOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	if !input.Confirm {
		return nil, huma.Error400BadRequest("checkpoint removal requires confirmation")
	}
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var revision models.DesignRevision
		query := tx.NewSelect().Model(&revision).Where("id = ? AND design_document_id = ?", input.RevisionID, document.ID)
		if tx.Dialect().Name() == dialect.PG {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return huma.Error404NotFound("OpenPost Image Editor checkpoint not found")
		} else if err != nil {
			return err
		}
		if revision.Kind != "checkpoint" {
			return huma.Error400BadRequest("only named checkpoints can be removed")
		}
		var mediaIDs []string
		if err := tx.NewSelect().Model((*models.DesignRevisionMediaReference)(nil)).Column("media_id").Where("revision_id = ?", revision.ID).Scan(txCtx, &mediaIDs); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.DesignRevisionMediaReference)(nil)).Where("revision_id = ?", revision.ID).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.DesignRevisionMediaIndexState)(nil)).Where("revision_id = ?", revision.ID).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model(&revision).WherePK().Exec(txCtx); err != nil {
			return err
		}
		return medialifecycle.TouchWithDB(txCtx, tx, mediaIDs, time.Now().UTC())
	})
	if err != nil {
		var status huma.StatusError
		if errors.As(err, &status) {
			return nil, err
		}
		return nil, huma.Error500InternalServerError("failed to remove OpenPost Image Editor checkpoint")
	}
	out := &DeleteImageEditorRevisionOutput{}
	out.Body.Deleted = true
	return out, nil
}

func (h *ImageEditorHandler) createCheckpoint(ctx context.Context, input *CreateImageEditorCheckpointInput) (*CreateImageEditorCheckpointOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("checkpoint name is required")
	}
	actorID := middleware.GetUserID(ctx)
	createdAt := time.Now().UTC()
	var revision *models.DesignRevision
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var current models.DesignDocument
		query := tx.NewSelect().Model(&current).
			Where("id = ? AND deleted_at IS NULL", document.ID)
		if tx.Dialect().Name() == dialect.PG {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); err != nil {
			return err
		}
		if current.Revision != input.Body.ExpectedRevision {
			return errImageEditorRevisionConflict
		}
		payload, err := imageEditorDocumentPayload(txCtx, tx, &current)
		if err != nil {
			return err
		}
		snapshot, err := compressImageEditorSnapshot(imageEditorRevisionSnapshot{
			SnapshotVersion:     imageEditorSnapshotVersion,
			Document:            payload,
			CoverPreviewMediaID: current.CoverPreviewMediaID,
		})
		if err != nil {
			return err
		}
		revision = &models.DesignRevision{
			ID:               uuid.NewString(),
			DesignDocumentID: current.ID,
			Revision:         current.Revision,
			Kind:             "checkpoint",
			Name:             name,
			Snapshot:         snapshot,
			CreatedByID:      actorID,
			CreatedAt:        createdAt,
		}
		if _, err := tx.NewInsert().Model(revision).Exec(txCtx); err != nil {
			return err
		}
		return storeImageEditorRevisionMediaReferences(
			txCtx,
			tx,
			revision.ID,
			payload,
			current.CoverPreviewMediaID,
			createdAt,
		)
	})
	if errors.Is(err, errImageEditorRevisionConflict) {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload before creating a checkpoint")
	}
	if err != nil || revision == nil {
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor checkpoint")
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, []string{currentUserID}, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision actor")
	}
	return &CreateImageEditorCheckpointOutput{Body: imageRevisionSummary(
		*revision,
		editorRevisionActor(actors, currentUserID, currentUserID),
	)}, nil
}

func (h *ImageEditorHandler) restoreRevision(ctx context.Context, input *RestoreImageEditorRevisionInput) (*RestoreImageEditorRevisionOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	actorID := middleware.GetUserID(ctx)
	err = h.restoreImageEditorRevisionInTx(
		ctx,
		document.ID,
		input.RevisionID,
		input.Body.ExpectedRevision,
		actorID,
		now,
	)
	if errors.Is(err, errImageEditorRevisionConflict) {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload before restoring")
	}
	if err != nil {
		var statusError huma.StatusError
		if errors.As(err, &statusError) {
			return nil, err
		}
		log.Printf("failed to restore OpenPost Image Editor design %s: %v", document.ID, err)
		return nil, huma.Error500InternalServerError("failed to restore OpenPost Image Editor revision")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &RestoreImageEditorRevisionOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) restoreImageEditorRevisionInTx(
	ctx context.Context,
	documentID string,
	revisionID string,
	expectedRevision int,
	actorID string,
	now time.Time,
) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		current, target, err := h.prepareImageEditorRevisionRestore(
			txCtx,
			tx,
			documentID,
			revisionID,
			expectedRevision,
			now,
		)
		if err != nil {
			return err
		}
		currentPayload, err := imageEditorDocumentPayload(txCtx, tx, &current)
		if err != nil {
			return err
		}
		if err := storeImageEditorRestorePoint(
			txCtx,
			tx,
			&current,
			currentPayload,
			actorID,
			now,
		); err != nil {
			return err
		}
		return applyImageEditorRevisionRestore(
			txCtx,
			tx,
			&current,
			target,
			expectedRevision,
			now,
		)
	})
}

func (h *ImageEditorHandler) prepareImageEditorRevisionRestore(
	ctx context.Context,
	tx bun.Tx,
	documentID string,
	revisionID string,
	expectedRevision int,
	now time.Time,
) (models.DesignDocument, imageEditorRevisionSnapshot, error) {
	var current models.DesignDocument
	if err := tx.NewSelect().Model(&current).
		Where("id = ? AND deleted_at IS NULL", documentID).
		Scan(ctx); err != nil {
		return current, imageEditorRevisionSnapshot{}, err
	}
	if current.Revision != expectedRevision {
		return current, imageEditorRevisionSnapshot{}, errImageEditorRevisionConflict
	}
	_, target, err := h.loadImageEditorRevisionSnapshot(ctx, tx, current.ID, revisionID)
	if err != nil {
		return current, target, err
	}
	if err := validateImageEditorPayload(target.Document); err != nil {
		return current, target, huma.Error400BadRequest("OpenPost Image Editor revision is invalid")
	}
	if err := validateImageEditorMediaReferences(
		ctx,
		tx,
		current.WorkspaceID,
		target.Document.Pages,
		target.CoverPreviewMediaID,
	); err != nil {
		return current, target, err
	}
	targetMediaIDs := append(
		imageEditorMediaIDs(target.Document.Pages),
		target.CoverPreviewMediaID,
	)
	if err := reviveEditorMediaReferences(
		ctx,
		tx,
		current.WorkspaceID,
		targetMediaIDs,
		now,
	); err != nil {
		return current, target, err
	}
	return current, target, nil
}

func storeImageEditorRestorePoint(
	ctx context.Context,
	tx bun.Tx,
	current *models.DesignDocument,
	currentPayload ImageEditorDocumentPayload,
	actorID string,
	now time.Time,
) error {
	snapshot, err := compressImageEditorSnapshot(imageEditorRevisionSnapshot{
		SnapshotVersion:     imageEditorSnapshotVersion,
		Document:            currentPayload,
		CoverPreviewMediaID: current.CoverPreviewMediaID,
	})
	if err != nil {
		return err
	}
	restorePoint := &models.DesignRevision{
		ID:               uuid.NewString(),
		DesignDocumentID: current.ID,
		Revision:         current.Revision,
		Kind:             "restore_point",
		Snapshot:         snapshot,
		CreatedByID:      actorID,
		CreatedAt:        now,
	}
	if _, err := tx.NewInsert().Model(restorePoint).Exec(ctx); err != nil {
		return err
	}
	return storeImageEditorRevisionMediaReferences(
		ctx,
		tx,
		restorePoint.ID,
		currentPayload,
		current.CoverPreviewMediaID,
		now,
	)
}

func applyImageEditorRevisionRestore(
	ctx context.Context,
	tx bun.Tx,
	current *models.DesignDocument,
	target imageEditorRevisionSnapshot,
	expectedRevision int,
	now time.Time,
) error {
	current.Title = strings.TrimSpace(target.Document.Title)
	current.SchemaVersion = target.Document.SchemaVersion
	current.Revision++
	current.PresetKey = target.Document.PresetKey
	current.WidthPX = target.Document.WidthPX
	current.HeightPX = target.Document.HeightPX
	current.BrandKitID = target.Document.BrandKitID
	current.BrandKitRevision = target.Document.BrandKitRevision
	current.ExportFormat = target.Document.ExportDefaults.Format
	current.ExportQuality = target.Document.ExportDefaults.Quality
	current.ExportMatteColor = defaultImageEditorBackground(target.Document.ExportDefaults.MatteColor)
	current.CoverPreviewMediaID = strings.TrimSpace(target.CoverPreviewMediaID)
	current.UpdatedAt = now
	result, err := tx.NewUpdate().Model(current).
		Column("title", "schema_version", "revision", "preset_key", "width_px", "height_px", "brand_kit_id", "brand_kit_revision", "export_format", "export_quality", "export_matte_color", "cover_preview_media_id", "updated_at").
		WherePK().
		Where("revision = ?", expectedRevision).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return errImageEditorRevisionConflict
	}
	if _, err := tx.NewDelete().Model((*models.DesignPage)(nil)).
		Where("design_document_id = ?", current.ID).
		Exec(ctx); err != nil {
		return err
	}
	if err := insertImageEditorPages(ctx, tx, current.ID, target.Document.Pages, now); err != nil {
		return err
	}
	return replaceImageEditorMediaReferences(ctx, tx, current, target.Document.Pages)
}

func (h *ImageEditorHandler) maybeStoreRecoveryRevision(
	ctx context.Context,
	tx bun.Tx,
	document *models.DesignDocument,
	payload ImageEditorDocumentPayload,
	force bool,
) error {
	var latest time.Time
	_ = tx.NewSelect().Model((*models.DesignRevision)(nil)).
		ColumnExpr("MAX(created_at)").
		Where("design_document_id = ? AND kind = ?", document.ID, "autosave").
		Scan(ctx, &latest)
	if !force && !latest.IsZero() && time.Since(latest) < 5*time.Minute {
		return nil
	}
	snapshot, err := compressImageEditorSnapshot(imageEditorRevisionSnapshot{
		SnapshotVersion:     imageEditorSnapshotVersion,
		Document:            payload,
		CoverPreviewMediaID: document.CoverPreviewMediaID,
	})
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	revision := &models.DesignRevision{
		ID:               uuid.NewString(),
		DesignDocumentID: document.ID,
		Revision:         document.Revision,
		Kind:             "autosave",
		Snapshot:         snapshot,
		CreatedByID:      middleware.GetUserID(ctx),
		CreatedAt:        now,
		ExpiresAt:        now.Add(imageEditorRecoveryRevisionTTL),
	}
	if _, err := tx.NewInsert().Model(revision).Exec(ctx); err != nil {
		return err
	}
	if err := storeImageEditorRevisionMediaReferences(
		ctx,
		tx,
		revision.ID,
		payload,
		document.CoverPreviewMediaID,
		revision.CreatedAt,
	); err != nil {
		return err
	}
	var expiredIDs []string
	if err := tx.NewSelect().Model((*models.DesignRevision)(nil)).
		Column("id").
		Where("design_document_id = ? AND kind = ? AND expires_at IS NOT NULL AND expires_at <= ?", document.ID, "autosave", now).
		OrderExpr("expires_at ASC, id ASC").
		Limit(1_000).
		Scan(ctx, &expiredIDs); err != nil {
		return err
	}
	var stale []models.DesignRevision
	if err := tx.NewSelect().Model(&stale).
		Where("design_document_id = ? AND kind = ?", document.ID, "autosave").
		OrderExpr("created_at DESC").
		Limit(1000).
		Offset(20).
		Scan(ctx); err != nil {
		return err
	}
	ids := append([]string(nil), expiredIDs...)
	for _, item := range stale {
		ids = append(ids, item.ID)
	}
	ids = uniqueImageEditorStringsInOrder(ids)
	if len(ids) > 0 {
		if _, err := tx.NewDelete().Model((*models.DesignRevision)(nil)).Where("id IN (?)", bun.List(ids)).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func compressImageEditorSnapshot(snapshot imageEditorRevisionSnapshot) ([]byte, error) {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(data); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func decompressImageEditorSnapshot(compressed []byte) (imageEditorRevisionSnapshot, error) {
	var snapshot imageEditorRevisionSnapshot
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return snapshot, err
	}
	defer reader.Close()
	const envelopeAllowance = 64 << 10
	data, err := io.ReadAll(io.LimitReader(reader, imageEditorMaxDocumentBytes+envelopeAllowance+1))
	if err != nil || len(data) > imageEditorMaxDocumentBytes+envelopeAllowance {
		return snapshot, fmt.Errorf("invalid OpenPost Image Editor snapshot")
	}
	var probe struct {
		SnapshotVersion int `json:"snapshot_version"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return snapshot, err
	}
	if probe.SnapshotVersion == 0 {
		if err := json.Unmarshal(data, &snapshot.Document); err != nil {
			return snapshot, err
		}
		return snapshot, nil
	}
	if probe.SnapshotVersion != imageEditorSnapshotVersion {
		return snapshot, fmt.Errorf("unsupported OpenPost Image Editor snapshot version %d", probe.SnapshotVersion)
	}
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return snapshot, err
	}
	return snapshot, nil
}

func storeImageEditorRevisionMediaReferences(
	ctx context.Context,
	tx bun.Tx,
	revisionID string,
	payload ImageEditorDocumentPayload,
	coverPreviewMediaID string,
	createdAt time.Time,
) error {
	mediaIDs := imageEditorMediaIDs(payload.Pages)
	mediaIDs = append(mediaIDs, coverPreviewMediaID)
	mediaIDs = uniqueImageEditorStringsInOrder(mediaIDs)
	if len(mediaIDs) > 0 {
		refs := make([]models.DesignRevisionMediaReference, 0, len(mediaIDs))
		for _, mediaID := range mediaIDs {
			refs = append(refs, models.DesignRevisionMediaReference{
				RevisionID: revisionID,
				MediaID:    mediaID,
				Usage:      "snapshot",
				CreatedAt:  createdAt,
			})
		}
		for start := 0; start < len(refs); start += imageEditorMediaWriteChunkSize {
			end := min(start+imageEditorMediaWriteChunkSize, len(refs))
			chunk := refs[start:end]
			if _, err := tx.NewInsert().Model(&chunk).Exec(ctx); err != nil {
				return err
			}
		}
	}
	state := &models.DesignRevisionMediaIndexState{
		RevisionID:  revisionID,
		MediaCount:  len(mediaIDs),
		Status:      "complete",
		ProcessedAt: createdAt,
	}
	_, err := tx.NewInsert().Model(state).Exec(ctx)
	return err
}

func imageRevisionSummary(
	revision models.DesignRevision,
	actor EditorRevisionActor,
) ImageEditorRevisionSummary {
	summary := ImageEditorRevisionSummary{
		ID:        revision.ID,
		Revision:  revision.Revision,
		Kind:      revision.Kind,
		Name:      revision.Name,
		CreatedAt: revision.CreatedAt.UTC().Format(time.RFC3339),
		Actor:     actor,
	}
	if !revision.ExpiresAt.IsZero() {
		summary.ExpiresAt = revision.ExpiresAt.UTC().Format(time.RFC3339)
	}
	return summary
}
