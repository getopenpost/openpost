package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

func (h *ImageEditorHandler) listDesigns(ctx context.Context, input *ListImageEditorDesignsInput) (*ListImageEditorDesignsOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.WorkspaceID) == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	deletionPredicate := "deleted_at IS NULL"
	if input.Trashed {
		deletionPredicate = "deleted_at IS NOT NULL"
	}
	query := h.db.NewSelect().Model((*models.DesignDocument)(nil)).
		Where("workspace_id = ?", input.WorkspaceID).Where(deletionPredicate)
	if search := strings.TrimSpace(input.Search); search != "" {
		query = query.Where("LOWER(title) LIKE ?", "%"+strings.ToLower(search)+"%")
	}
	total, err := query.Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count OpenPost Image Editor designs")
	}
	var rows []struct {
		models.DesignDocument
		PageCount              int    `bun:"page_count"`
		FallbackPreviewMediaID string `bun:"fallback_preview_media_id"`
	}
	err = h.db.NewSelect().
		TableExpr("design_documents AS d").
		ColumnExpr("d.*").
		ColumnExpr("(SELECT COUNT(*) FROM design_pages p WHERE p.design_document_id = d.id) AS page_count").
		ColumnExpr(`(
			SELECT r.media_id
			FROM design_media_references AS r
			JOIN media_attachments AS m ON m.id = r.media_id
			WHERE r.design_document_id = d.id
				AND r.usage = 'layer'
				AND m.asset_kind = 'library'
			ORDER BY r.created_at ASC
			LIMIT 1
		) AS fallback_preview_media_id`).
		Where("d.workspace_id = ?", input.WorkspaceID).Where("d."+deletionPredicate).
		Apply(func(q *bun.SelectQuery) *bun.SelectQuery {
			if search := strings.TrimSpace(input.Search); search != "" {
				return q.Where("LOWER(d.title) LIKE ?", "%"+strings.ToLower(search)+"%")
			}
			return q
		}).
		OrderExpr("d.updated_at DESC").
		Limit(int64(limit)).
		Offset(int64(input.Offset)).
		Scan(ctx, &rows)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list OpenPost Image Editor designs")
	}
	out := &ListImageEditorDesignsOutput{}
	out.Body.Total = int(total)
	out.Body.CanEdit = canEdit
	out.Body.Designs = make([]ImageEditorDesignSummary, 0, len(rows))
	for _, row := range rows {
		if row.CoverPreviewMediaID == "" {
			row.CoverPreviewMediaID = row.FallbackPreviewMediaID
		}
		out.Body.Designs = append(out.Body.Designs, designSummary(row.DesignDocument, row.PageCount))
	}
	return out, nil
}

func (h *ImageEditorHandler) createDesign(ctx context.Context, input *CreateImageEditorDesignInput) (*CreateImageEditorDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if _, err := h.requireAccess(ctx, workspaceID, true); err != nil {
		return nil, err
	}
	userID := middleware.GetUserID(ctx)
	clientRequestID := strings.TrimSpace(input.Body.ClientRequestID)
	documentID, existing, err := h.resolveCreateDesignRequest(
		ctx,
		userID,
		workspaceID,
		clientRequestID,
	)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &CreateImageEditorDesignOutput{Body: *existing}, nil
	}
	width, height, presetKey, err := resolveImageEditorDimensions(input.Body.PresetKey, input.Body.WidthPX, input.Body.HeightPX)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	title := strings.TrimSpace(input.Body.Title)
	if title == "" {
		title = "Untitled design"
	}
	now := time.Now().UTC()
	document := &models.DesignDocument{
		ID:               documentID,
		WorkspaceID:      workspaceID,
		CreatedByID:      userID,
		Title:            title,
		SchemaVersion:    imageEditorSchemaVersion,
		Revision:         1,
		PresetKey:        presetKey,
		WidthPX:          width,
		HeightPX:         height,
		ExportFormat:     defaultImageEditorFormat(presetKey),
		ExportQuality:    0.92,
		ExportMatteColor: "#ffffff",
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	page := ImageEditorPagePayload{
		ID:              uuid.NewString(),
		Name:            "Page 1",
		BackgroundColor: "#ffffff",
		Background:      defaultImageEditorPageBackground("#ffffff"),
		Layers:          []ImageEditorLayer{},
	}
	if err := h.attachCreateDesignSource(
		ctx,
		workspaceID,
		input.Body.SourceMediaID,
		width,
		height,
		document,
		&page,
	); err != nil {
		return nil, err
	}
	if existing, err := h.sourceEditingDesign(ctx, document); err != nil || existing != nil {
		return existing, err
	}
	payload := ImageEditorDocumentPayload{
		SchemaVersion: imageEditorSchemaVersion,
		Title:         title,
		PresetKey:     presetKey,
		WidthPX:       width,
		HeightPX:      height,
		ExportDefaults: ImageEditorExportDefaults{
			Format:     defaultImageEditorFormat(presetKey),
			Quality:    0.92,
			MatteColor: "#ffffff",
		},
		Pages: []ImageEditorPagePayload{page},
	}
	if err := validateImageEditorPayload(payload); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	return h.completeDesignCreation(ctx, document, payload.Pages, clientRequestID)
}

func (h *ImageEditorHandler) completeDesignCreation(ctx context.Context, document *models.DesignDocument, pages []ImageEditorPagePayload, clientRequestID string) (*CreateImageEditorDesignOutput, error) {
	if err := h.insertCreatedDesign(ctx, document, pages, document.CreatedAt); err != nil {
		if existing, lookupErr := h.sourceEditingDesign(ctx, document); lookupErr == nil && existing != nil {
			return existing, nil
		}
		if clientRequestID != "" {
			if response, responseErr := h.documentResponse(ctx, document.ID); responseErr == nil {
				return &CreateImageEditorDesignOutput{Body: *response}, nil
			}
		}
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &CreateImageEditorDesignOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) sourceEditingDesign(ctx context.Context, source *models.DesignDocument) (*CreateImageEditorDesignOutput, error) {
	if source.SourceMediaID == "" {
		return nil, nil
	}
	var existing models.DesignDocument
	err := h.db.NewSelect().Model(&existing).
		Where("workspace_id = ? AND source_media_id = ? AND deleted_at IS NULL", source.WorkspaceID, source.SourceMediaID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to find source editing design")
	}
	response, err := h.documentResponse(ctx, existing.ID)
	if err != nil {
		return nil, err
	}
	return &CreateImageEditorDesignOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) resolveCreateDesignRequest(
	ctx context.Context,
	userID string,
	workspaceID string,
	clientRequestID string,
) (string, *ImageEditorDocumentResponse, error) {
	if clientRequestID == "" {
		return uuid.NewString(), nil, nil
	}
	documentID := uuid.NewSHA1(
		uuid.NameSpaceURL,
		[]byte(fmt.Sprintf("openpost:image-editor-design:%s:%s:%s", userID, workspaceID, clientRequestID)),
	).String()
	exists, err := h.db.NewSelect().
		Model((*models.DesignDocument)(nil)).
		Where("id = ? AND workspace_id = ? AND created_by_id = ?", documentID, workspaceID, userID).
		Exists(ctx)
	if err != nil {
		return "", nil, huma.Error500InternalServerError("failed to check OpenPost Image Editor design request")
	}
	if !exists {
		return documentID, nil, nil
	}
	response, err := h.documentResponse(ctx, documentID)
	if err != nil {
		return "", nil, err
	}
	return documentID, response, nil
}

func (h *ImageEditorHandler) attachCreateDesignSource(
	ctx context.Context,
	workspaceID string,
	sourceMediaID string,
	width int,
	height int,
	document *models.DesignDocument,
	page *ImageEditorPagePayload,
) error {
	sourceID := strings.TrimSpace(sourceMediaID)
	if sourceID == "" {
		return nil
	}
	var media models.MediaAttachment
	err := h.db.NewSelect().Model(&media).
		Where("id = ? AND workspace_id = ? AND asset_kind = ?", sourceID, workspaceID, "library").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return huma.Error404NotFound(errMediaNotFound)
	}
	if err != nil {
		return huma.Error500InternalServerError("failed to load source media")
	}
	document.SourceMediaID = media.ID
	document.CoverPreviewMediaID = media.ID
	page.Layers = append(page.Layers, newImageEditorImageLayer(media, width, height))
	return nil
}

func (h *ImageEditorHandler) insertCreatedDesign(
	ctx context.Context,
	document *models.DesignDocument,
	pages []ImageEditorPagePayload,
	now time.Time,
) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(document).Exec(txCtx); err != nil {
			return err
		}
		if err := insertImageEditorPages(txCtx, tx, document.ID, pages, now); err != nil {
			return err
		}
		return replaceImageEditorMediaReferences(txCtx, tx, document, pages)
	})
}

func (h *ImageEditorHandler) getDesign(ctx context.Context, input *GetImageEditorDesignInput) (*GetImageEditorDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	response, err := h.documentResponse(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	return &GetImageEditorDesignOutput{Body: *response}, nil
}

//nolint:gocyclo // The transaction keeps validation, CAS, page replacement, references, and recovery atomic.
func (h *ImageEditorHandler) updateDesign(ctx context.Context, input *UpdateImageEditorDesignInput) (*UpdateImageEditorDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	if err := validateImageEditorPayload(input.Body.Document); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	if document.Revision != input.Body.ExpectedRevision {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload or save a copy")
	}
	if err := h.validateMediaReferences(
		ctx,
		document.WorkspaceID,
		input.Body.Document.Pages,
		input.Body.CoverPreviewID,
	); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	nextRevision := document.Revision + 1
	document.Title = strings.TrimSpace(input.Body.Document.Title)
	document.SchemaVersion = input.Body.Document.SchemaVersion
	document.Revision = nextRevision
	document.PresetKey = input.Body.Document.PresetKey
	document.WidthPX = input.Body.Document.WidthPX
	document.HeightPX = input.Body.Document.HeightPX
	document.BrandKitID = input.Body.Document.BrandKitID
	document.BrandKitRevision = input.Body.Document.BrandKitRevision
	document.ExportFormat = input.Body.Document.ExportDefaults.Format
	document.ExportQuality = input.Body.Document.ExportDefaults.Quality
	document.ExportMatteColor = defaultImageEditorBackground(input.Body.Document.ExportDefaults.MatteColor)
	document.CoverPreviewMediaID = strings.TrimSpace(input.Body.CoverPreviewID)
	document.UpdatedAt = now

	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model(document).
			Column("title", "schema_version", "revision", "preset_key", "width_px", "height_px", "brand_kit_id", "brand_kit_revision", "export_format", "export_quality", "export_matte_color", "cover_preview_media_id", "updated_at").
			WherePK().
			Where("revision = ?", input.Body.ExpectedRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return errImageEditorRevisionConflict
		}
		if _, err := tx.NewDelete().Model((*models.DesignPage)(nil)).
			Where("design_document_id = ?", document.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if err := insertImageEditorPages(txCtx, tx, document.ID, input.Body.Document.Pages, now); err != nil {
			return err
		}
		if err := replaceImageEditorMediaReferences(txCtx, tx, document, input.Body.Document.Pages); err != nil {
			return err
		}
		return h.maybeStoreRecoveryRevision(
			txCtx,
			tx,
			document,
			input.Body.Document,
			input.Body.RecoveryReason == "export" || input.Body.RecoveryReason == "close",
		)
	})
	if errors.Is(err, errImageEditorRevisionConflict) {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload or save a copy")
	}
	if err != nil {
		log.Printf("failed to save OpenPost Image Editor design %s: %v", document.ID, err)
		return nil, huma.Error500InternalServerError("failed to save OpenPost Image Editor design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &UpdateImageEditorDesignOutput{Body: *response}, nil
}

var errImageEditorRevisionConflict = errors.New("image editor revision conflict")

func (h *ImageEditorHandler) deleteDesign(ctx context.Context, input *DeleteImageEditorDesignInput) (*DeleteImageEditorDesignOutput, error) {
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
	result, err := h.db.NewUpdate().Model((*models.DesignDocument)(nil)).
		Set("deleted_at = ?", time.Now().UTC()).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ? AND deleted_at IS NULL", document.ID).
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to delete OpenPost Image Editor design")
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, huma.Error404NotFound("OpenPost Image Editor design not found")
	}
	return &DeleteImageEditorDesignOutput{Body: struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true}}, nil
}

func (h *ImageEditorHandler) restoreDesign(ctx context.Context, input *DeleteImageEditorDesignInput) (*GetImageEditorDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	var document models.DesignDocument
	err := h.db.NewSelect().Model(&document).Where("id = ? AND deleted_at IS NOT NULL", input.PathID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("trashed OpenPost Image Editor design not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load trashed design")
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	result, err := h.db.NewUpdate().Model((*models.DesignDocument)(nil)).
		Set("deleted_at = NULL").Set("source_media_id = NULL").
		Set("updated_at = ?", time.Now().UTC()).Set("revision = revision + 1").
		Where("id = ? AND deleted_at IS NOT NULL", document.ID).Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to restore design")
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to restore design")
	}
	if affected == 0 {
		return nil, huma.Error404NotFound("trashed design not found")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &GetImageEditorDesignOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) toggleDesignFavorite(ctx context.Context, input *ToggleImageEditorDesignFavoriteInput) (*ToggleImageEditorDesignFavoriteOutput, error) {
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
	document.IsFavorite = !document.IsFavorite
	_, err = h.db.NewUpdate().
		Model(document).
		Column("is_favorite").
		WherePK().
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to update OpenPost Image Editor design favorite")
	}
	out := &ToggleImageEditorDesignFavoriteOutput{}
	out.Body.IsFavorite = document.IsFavorite
	return out, nil
}

func (h *ImageEditorHandler) duplicateDesign(ctx context.Context, input *DuplicateImageEditorDesignInput) (*DuplicateImageEditorDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	source, err := h.documentResponse(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, source.WorkspaceID, true); err != nil {
		return nil, err
	}
	payload := cloneImageEditorPayload(source.Document)
	payload.Title = strings.TrimSpace(source.Document.Title) + " copy"
	now := time.Now().UTC()
	document := &models.DesignDocument{
		ID:                  uuid.NewString(),
		WorkspaceID:         source.WorkspaceID,
		CreatedByID:         middleware.GetUserID(ctx),
		Title:               payload.Title,
		SchemaVersion:       payload.SchemaVersion,
		Revision:            1,
		PresetKey:           payload.PresetKey,
		WidthPX:             payload.WidthPX,
		HeightPX:            payload.HeightPX,
		BrandKitID:          payload.BrandKitID,
		BrandKitRevision:    payload.BrandKitRevision,
		ExportFormat:        payload.ExportDefaults.Format,
		ExportQuality:       payload.ExportDefaults.Quality,
		ExportMatteColor:    defaultImageEditorBackground(payload.ExportDefaults.MatteColor),
		CoverPreviewMediaID: source.CoverPreviewMediaID,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(document).Exec(txCtx); err != nil {
			return err
		}
		if err := insertImageEditorPages(txCtx, tx, document.ID, payload.Pages, now); err != nil {
			return err
		}
		return replaceImageEditorMediaReferences(txCtx, tx, document, payload.Pages)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to duplicate OpenPost Image Editor design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &DuplicateImageEditorDesignOutput{Body: *response}, nil
}
