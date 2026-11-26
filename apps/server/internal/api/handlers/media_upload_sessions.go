package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/videoprojects"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (h *MediaHandler) createMediaUploadSession(ctx context.Context, input *CreateMediaUploadSessionInput) (*CreateMediaUploadSessionOutput, error) {
	userID := middleware.GetUserID(ctx)
	actor := workspaceActor(ctx, userID)

	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, workspaceID); err != nil {
		return nil, err
	}
	var idempotencyRequest *idempotency.Request
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, requestErr := mutationIdempotencyRequest(ctx, workspaceID, "create-media-upload-session", input.IdempotencyKey)
		if requestErr != nil {
			return nil, requestErr
		}
		request.RequestHash, requestErr = idempotency.Hash(input.Body)
		if requestErr != nil {
			return nil, huma.Error400BadRequest("failed to normalize upload request")
		}
		if replay, found, replayErr := idempotency.Replay[CreateMediaUploadSessionResponse](ctx, h.db, request); found || replayErr != nil {
			if replayErr != nil {
				return nil, publicationMutationHTTPError(replayErr, "failed to replay media upload session")
			}
			return &CreateMediaUploadSessionOutput{Body: replay.Value}, nil
		}
		idempotencyRequest = &request
	}
	params, err := h.resolveCreateMediaUploadParams(ctx, actor, workspaceID, input)
	if err != nil {
		return nil, err
	}
	params.idempotencyRequest = idempotencyRequest
	// Prepared images need their own input lineage, even when encoded bytes match
	// an unrelated library asset.
	clientHash := input.Body.ClientSHA256
	if params.source == "image_optimization" || params.source == "image_fit" {
		clientHash = ""
	}
	reusable, err := h.reusableMediaForClientHash(ctx, params.workspaceID, clientHash, input.Body.Size, params.mimeType, params.assetKind)
	if err != nil {
		return nil, err
	}
	if reusable != nil {
		return h.createMediaUploadSessionFromReuse(ctx, actor, params, reusable, input)
	}
	return h.reserveNewMediaUploadSession(ctx, actor, params, input)
}

type createMediaUploadParams struct {
	workspaceID        string
	filename           string
	source             string
	assetKind          string
	projectAssetID     string
	tagID              string
	retentionClass     string
	mimeType           string
	idempotencyRequest *idempotency.Request
}

func (h *MediaHandler) resolveCreateMediaUploadParams(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string, input *CreateMediaUploadSessionInput) (*createMediaUploadParams, error) {
	filename := cleanUploadFilename(input.Body.Filename)
	if filename == "" {
		return nil, huma.Error400BadRequest("filename is required")
	}
	if input.Body.Size <= 0 {
		return nil, huma.Error400BadRequest("size must be positive")
	}
	source, assetKind, err := normalizeMediaProvenance(input.Body.Source, input.Body.AssetKind)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	projectAssetID := strings.TrimSpace(input.Body.ProjectAssetID)
	if assetKind == "project_asset" && projectAssetID == "" {
		return nil, huma.Error400BadRequest("project_asset_id is required for Project Asset uploads")
	}
	if assetKind != "project_asset" && projectAssetID != "" {
		return nil, huma.Error400BadRequest("project_asset_id is allowed only for Project Asset uploads")
	}
	tagID, retentionClass, err := h.resolveMediaUploadStoragePolicy(ctx, workspaceID, input, source, assetKind)
	if err != nil {
		return nil, err
	}
	mimeType := strings.TrimSpace(input.Body.MimeType)
	if mimeType == "" {
		mimeType = defaultMediaMimeType
	}
	if err := validateMediaUploadDeclaration(filename, input.Body.MimeType); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	sizeLimit := mediaUploadSizeLimit(assetKind, filename, mimeType)
	if input.Body.Size > sizeLimit {
		return nil, huma.Error400BadRequest(mediaUploadSizeError(sizeLimit))
	}
	if !isInternalMediaAssetKind(assetKind) {
		if err := h.checkUploadQuota(ctx, workspaceID, input.Body.Size); err != nil {
			return nil, h.markMediaUploadQuotaExceeded(ctx, actor, workspaceID, projectAssetID, err)
		}
	}
	if err := h.validateMediaProvenanceReferences(
		ctx,
		workspaceID,
		input.Body.ParentMediaID,
		input.Body.DesignDocumentID,
		input.Body.DesignPageID,
	); err != nil {
		return nil, err
	}

	return &createMediaUploadParams{workspaceID: workspaceID, filename: filename, source: source, assetKind: assetKind, projectAssetID: projectAssetID, tagID: tagID, retentionClass: retentionClass, mimeType: mimeType}, nil
}

func (h *MediaHandler) resolveMediaUploadStoragePolicy(ctx context.Context, workspaceID string, input *CreateMediaUploadSessionInput, source, assetKind string) (string, string, error) {
	tagID, err := h.resolveMediaUploadTag(ctx, workspaceID, input.Body.TagID, assetKind)
	if err != nil {
		return "", "", err
	}
	retentionClass, err := medialifecycle.NormalizeRetention(input.Body.RetentionClass, assetKind, tagID != "")
	if err != nil {
		return "", "", huma.Error400BadRequest(err.Error())
	}
	if err := validateStockUploadProvenance(source, input.Body.StockProvenance); err != nil {
		return "", "", huma.Error400BadRequest(err.Error())
	}
	return tagID, retentionClass, nil
}

func (h *MediaHandler) markMediaUploadQuotaExceeded(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, projectAssetID string, quotaErr error) error {
	if projectAssetID != "" {
		if markErr := videoprojects.MarkAssetNeedsStorage(ctx, h.db, actor, workspaceID, projectAssetID, quotaErr.Error()); markErr != nil {
			return videoProjectError(markErr, "mark asset storage state for")
		}
	}
	return huma.Error400BadRequest(quotaErr.Error())
}

func (h *MediaHandler) createMediaUploadSessionFromReuse(ctx context.Context, actor workspaceaccess.ActorFacts, params *createMediaUploadParams, reusable *models.MediaAttachment, input *CreateMediaUploadSessionInput) (*CreateMediaUploadSessionOutput, error) {
	response := CreateMediaUploadSessionResponse{MediaID: reusable.ID, Deduped: true, ProjectAssetID: params.projectAssetID}
	if params.idempotencyRequest != nil {
		params.idempotencyRequest.ResourceID = reusable.ID
		result, executeErr := idempotency.Execute(ctx, h.db, *params.idempotencyRequest, func(txCtx context.Context, tx bun.Tx) (CreateMediaUploadSessionResponse, error) {
			if params.projectAssetID != "" {
				if err := videoprojects.BindAssetMediaWithDB(txCtx, tx, actor, params.workspaceID, params.projectAssetID, reusable.ID, models.ProjectAssetStatusReady, input.Body.ClientSHA256); err != nil {
					return CreateMediaUploadSessionResponse{}, videoProjectError(err, "reuse media for")
				}
			}
			if err := h.persistStockMediaProvenanceWithDB(txCtx, tx, reusable.ID, input.Body.StockProvenance); err != nil {
				return CreateMediaUploadSessionResponse{}, huma.Error500InternalServerError("failed to save stock media provenance")
			}
			if err := h.addMediaTagWithDB(txCtx, tx, params.tagID, reusable.ID); err != nil {
				return CreateMediaUploadSessionResponse{}, err
			}
			return response, nil
		})
		if executeErr != nil {
			return nil, publicationMutationHTTPError(executeErr, "failed to reserve media upload")
		}
		return &CreateMediaUploadSessionOutput{Body: result.Value}, nil
	}
	if err := h.persistStockMediaProvenance(ctx, reusable.ID, input.Body.StockProvenance); err != nil {
		return nil, huma.Error500InternalServerError("failed to save stock media provenance")
	}
	if err := h.addMediaTag(ctx, params.tagID, reusable.ID); err != nil {
		return nil, err
	}
	if params.projectAssetID != "" {
		if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			return videoprojects.BindAssetMediaWithDB(txCtx, tx, actor, params.workspaceID, params.projectAssetID, reusable.ID, models.ProjectAssetStatusReady, input.Body.ClientSHA256)
		}); err != nil {
			return nil, videoProjectError(err, "reuse media for")
		}
	}
	return &CreateMediaUploadSessionOutput{Body: response}, nil
}

func (h *MediaHandler) reserveNewMediaUploadSession(ctx context.Context, actor workspaceaccess.ActorFacts, params *createMediaUploadParams, input *CreateMediaUploadSessionInput) (*CreateMediaUploadSessionOutput, error) {
	mediaID := uuid.New().String()
	objectKey := mediaID + filepath.Ext(params.filename)
	sessionTTL := mediaUploadSessionTTL(input.Body.Size)
	var session *mediastore.DirectUploadSession
	var err error
	if directStorage, ok := h.storage.(mediastore.DirectUploadStorage); ok && input.Body.Size <= MaxDirectMediaUploadBytes {
		session, err = directStorage.CreateDirectUploadSession(ctx, mediastore.DirectUploadInput{
			Key:         objectKey,
			ContentType: params.mimeType,
			Size:        input.Body.Size,
			ExpiresIn:   sessionTTL,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create media upload session")
		}
	} else if h.storage != nil {
		session = &mediastore.DirectUploadSession{
			Method: http.MethodPut,
			URL:    "/api/v1/media/upload-session/" + mediaID + "/content",
			Headers: map[string]string{
				"Content-Type": params.mimeType,
			},
			Key:       objectKey,
			ExpiresAt: time.Now().UTC().Add(sessionTTL),
		}
	} else {
		return nil, huma.Error400BadRequest("streaming media upload sessions are unavailable")
	}

	now := time.Now().UTC()
	media := &models.MediaAttachment{
		ID:                 mediaID,
		WorkspaceID:        params.workspaceID,
		FilePath:           session.Key,
		StorageType:        h.storage.Driver(),
		MimeType:           params.mimeType,
		ProcessingStatus:   mediaProcessingStatus,
		ProcessingProgress: 0,
		Size:               input.Body.Size,
		OriginalFilename:   params.filename,
		FileHash:           "pending:" + mediaID,
		Source:             params.source,
		AssetKind:          params.assetKind,
		RetentionClass:     params.retentionClass,
		ParentMediaID:      strings.TrimSpace(input.Body.ParentMediaID),
		DesignDocumentID:   strings.TrimSpace(input.Body.DesignDocumentID),
		DesignPageID:       strings.TrimSpace(input.Body.DesignPageID),
		AltText:            input.Body.AltText,
		AnalysisStatus:     mediaanalysis.AnalysisStatusPending,
		LastUsedAt:         now,
		CreatedAt:          now,
	}
	response := CreateMediaUploadSessionResponse{
		MediaID: mediaID, ProjectAssetID: params.projectAssetID,
		Upload: DirectMediaUploadTarget{
			Method:    session.Method,
			URL:       session.URL,
			Headers:   session.Headers,
			ExpiresAt: session.ExpiresAt.Format(time.RFC3339),
			ObjectKey: session.Key,
		},
		CompleteURL: "/api/v1/media/upload-session/" + mediaID + "/complete",
		Deduped:     false,
	}
	persist := func(persistCtx context.Context, db bun.IDB) error {
		if err := h.serializeMediaAdmission(persistCtx, db, *media, "", false); err != nil {
			return mediaAdmissionHTTPError(err, "failed to reserve media upload")
		}
		if _, err := db.NewInsert().Model(media).Exec(persistCtx); err != nil {
			return huma.Error500InternalServerError("failed to reserve media upload")
		}
		if params.projectAssetID != "" {
			if err := videoprojects.BindAssetMediaWithDB(persistCtx, db, actor, params.workspaceID, params.projectAssetID, media.ID, models.ProjectAssetStatusUploading, input.Body.ClientSHA256); err != nil {
				return videoProjectError(err, "bind media to")
			}
		}
		if err := h.addMediaTagWithDB(persistCtx, db, params.tagID, media.ID); err != nil {
			return err
		}
		if err := h.persistStockMediaProvenanceWithDB(persistCtx, db, media.ID, input.Body.StockProvenance); err != nil {
			return huma.Error500InternalServerError("failed to save stock media provenance")
		}
		return nil
	}
	if params.idempotencyRequest != nil {
		params.idempotencyRequest.ResourceID = media.ID
		result, executeErr := idempotency.Execute(ctx, h.db, *params.idempotencyRequest, func(txCtx context.Context, tx bun.Tx) (CreateMediaUploadSessionResponse, error) {
			return response, persist(txCtx, tx)
		})
		if executeErr != nil {
			return nil, publicationMutationHTTPError(executeErr, "failed to reserve media upload")
		}
		return &CreateMediaUploadSessionOutput{Body: result.Value}, nil
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return persist(txCtx, tx)
	}); err != nil {
		var statusError huma.StatusError
		if errors.As(err, &statusError) {
			return nil, err
		}
		return nil, mediaAdmissionHTTPError(err, "failed to reserve media upload")
	}
	return &CreateMediaUploadSessionOutput{Body: response}, nil
}

func (h *MediaHandler) completeMediaUploadSession(ctx context.Context, input *CompleteMediaUploadSessionInput) (*CompleteMediaUploadSessionOutput, error) {
	userID := middleware.GetUserID(ctx)
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}

	result, err := h.completeDirectMediaUpload(ctx, userID, workspaceID, input.PathID)
	if err != nil {
		return nil, err
	}
	return &CompleteMediaUploadSessionOutput{Body: result}, nil
}

func mediaUploadSessionTTL(size int64) time.Duration {
	if size <= 0 {
		return MediaUploadSessionTTL
	}
	estimated := 10*time.Minute + time.Duration(size/(1024*1024))*time.Second
	if estimated < MediaUploadSessionTTL {
		return MediaUploadSessionTTL
	}
	if estimated > maxMediaUploadSessionTTL {
		return maxMediaUploadSessionTTL
	}
	return estimated
}

func (h *MediaHandler) supportsUploadSessions() bool {
	if h.storage == nil {
		return false
	}
	return h.storage.Driver() == "local" || h.storage.Driver() == "s3"
}

func (h *MediaHandler) completeDirectMediaUpload(ctx context.Context, userID, workspaceID, mediaID string) (MediaUploadResult, error) {
	var result MediaUploadResult
	media, err := h.loadDirectMediaUpload(ctx, userID, workspaceID, mediaID)
	if err != nil {
		return result, err
	}
	if directMediaUploadFinalized(media) {
		if err := h.completeProjectAssetForMedia(ctx, workspaceID, media.ID, media.FileHash); err != nil {
			return result, err
		}
		return mediaUploadResultFromAttachment(media, false), nil
	}

	inspection, err := h.inspectDirectMediaUpload(ctx, media)
	if err != nil {
		var validation huma.StatusError
		if errors.As(err, &validation) && validation.GetStatus() == http.StatusBadRequest {
			h.discardInvalidDirectUpload(ctx, &media)
		}
		return result, err
	}

	if err := h.checkDirectUploadQuota(ctx, workspaceID, media, inspection.Size); err != nil {
		return result, err
	}

	validationContent := inspection.Content
	if len(validationContent) == 0 {
		validationContent = inspection.Prefix
	}
	if err := validateMediaAssetContent(media.AssetKind, media.OriginalFilename, media.MimeType, validationContent); err != nil {
		h.discardInvalidDirectUpload(ctx, &media)
		return result, huma.Error400BadRequest(err.Error())
	}

	if err := validateMediaImageContent(detectedMediaMimeType(inspection.Prefix, media.MimeType), validationContent); err != nil {
		h.discardInvalidDirectUpload(ctx, &media)
		return result, huma.Error400BadRequest(err.Error())
	}

	fileHash := inspection.FileHash
	if duplicate, found, err := h.deduplicateDirectMediaUpload(ctx, workspaceID, fileHash, media, inspection.Content); err != nil {
		return result, err
	} else if found {
		return duplicate, nil
	}

	media, err = h.finalizeDirectMediaUploadRecord(ctx, media, inspection)
	if err != nil {
		return h.recoverDirectUploadFinalization(ctx, workspaceID, fileHash, media, inspection.Content, err)
	}
	return h.completeProjectAssetUpload(ctx, workspaceID, media, fileHash)
}

// errDirectUploadImageDimensions marks an image whose bytes decode without
// usable dimensions. Such an upload is discarded instead of becoming ready.
var errDirectUploadImageDimensions = errors.New("uploaded image dimensions could not be determined")

func (h *MediaHandler) recoverDirectUploadFinalization(
	ctx context.Context,
	workspaceID string,
	fileHash string,
	media models.MediaAttachment,
	inspectedContent []byte,
	err error,
) (MediaUploadResult, error) {
	if errors.Is(err, errDirectUploadImageDimensions) {
		h.discardInvalidDirectUpload(ctx, &media)
		return MediaUploadResult{}, huma.Error400BadRequest(err.Error())
	}
	if duplicate, deduped := h.resolveDirectUploadDeduplication(ctx, workspaceID, fileHash, media, inspectedContent); deduped {
		return duplicate, nil
	}
	return MediaUploadResult{}, err
}

// Retain the failed reservation until the lifecycle sweep, which runs after
// every issued upload capability has expired. A late PUT then still has a
// durable object key and remains included in stored-byte accounting.
func (h *MediaHandler) discardInvalidDirectUpload(ctx context.Context, media *models.MediaAttachment) {
	if err := h.retirePendingDirectUpload(ctx, media); err != nil {
		log.Printf("failed to invalidate direct upload %s: %v", media.ID, err)
	}
}

func (h *MediaHandler) retirePendingDirectUpload(ctx context.Context, media *models.MediaAttachment) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), mediaUploadCleanupTimeout)
	defer cancel()
	result, err := h.db.NewUpdate().Model((*models.MediaAttachment)(nil)).Set("processing_status = ?", mediaFailedStatus).
		Where("id = ? AND workspace_id = ? AND file_hash LIKE ? AND processing_status IN (?, ?)", media.ID, media.WorkspaceID, "pending:%", mediaProcessingStatus, mediaUploadingStatus).Exec(cleanupCtx)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 1 {
		return nil
	}
	// Immediate cleanup is best effort. The retained tombstone causes another
	// durable deletion after the capability lifetime, including any later PUT.
	if err := h.deleteMediaFiles(cleanupCtx, media); err != nil {
		log.Printf("failed to remove retired direct upload %s: %v", media.ID, err)
	}
	return nil
}

func (h *MediaHandler) checkDirectUploadQuota(ctx context.Context, workspaceID string, media models.MediaAttachment, size int64) error {
	if isInternalMediaAssetKind(media.AssetKind) {
		return nil
	}
	if err := h.checkUploadQuotaExcludingMedia(ctx, workspaceID, size, media.ID); err != nil {
		if media.AssetKind == "project_asset" {
			_ = videoprojects.MarkAssetNeedsStorageForMedia(ctx, h.db, workspaceID, media.ID, err.Error())
		}
		return huma.Error400BadRequest(err.Error())
	}
	return nil
}

func (h *MediaHandler) deduplicateDirectMediaUpload(ctx context.Context, workspaceID, fileHash string, media models.MediaAttachment, inspectedContent []byte) (MediaUploadResult, bool, error) {
	if !directMediaUploadSupportsDeduplication(media) {
		return MediaUploadResult{}, false, nil
	}
	existing, found, err := h.findDuplicateMedia(ctx, workspaceID, fileHash, media.ID)
	if err != nil || !found {
		return MediaUploadResult{}, false, err
	}
	if err := h.repairDimensionlessDirectUploadDuplicate(ctx, &existing, inspectedContent); err != nil {
		return MediaUploadResult{}, false, huma.Error500InternalServerError("failed to prepare duplicate image metadata")
	}
	if err := h.transferMediaTagAssignments(ctx, media.ID, existing.ID); err != nil {
		return MediaUploadResult{}, false, err
	}
	if err := h.retirePendingDirectUpload(ctx, &media); err != nil {
		return MediaUploadResult{}, false, huma.Error500InternalServerError("failed to deduplicate media upload")
	}
	return mediaUploadResultFromAttachment(existing, true), true, nil
}

func (h *MediaHandler) completeProjectAssetUpload(ctx context.Context, workspaceID string, media models.MediaAttachment, fileHash string) (MediaUploadResult, error) {
	var result MediaUploadResult
	if err := h.completeProjectAssetForMedia(ctx, workspaceID, media.ID, fileHash); err != nil {
		return result, err
	}

	return mediaUploadResultFromAttachment(media, false), nil
}

func (h *MediaHandler) completeProjectAssetForMedia(ctx context.Context, workspaceID, mediaID, fileHash string) error {
	if err := videoprojects.CompleteAssetForMedia(ctx, h.db, workspaceID, mediaID, fileHash); err != nil {
		return huma.Error500InternalServerError("failed to complete Project Asset")
	}
	return nil
}

func (h *MediaHandler) resolveDirectUploadDeduplication(
	ctx context.Context,
	workspaceID string,
	fileHash string,
	media models.MediaAttachment,
	inspectedContent []byte,
) (MediaUploadResult, bool) {
	if !directMediaUploadSupportsDeduplication(media) {
		return MediaUploadResult{}, false
	}
	existing, found, err := h.findDuplicateMedia(ctx, workspaceID, fileHash, media.ID)
	if err != nil || !found {
		return MediaUploadResult{}, false
	}
	if err := h.repairDimensionlessDirectUploadDuplicate(ctx, &existing, inspectedContent); err != nil {
		return MediaUploadResult{}, false
	}
	if err := h.transferMediaTagAssignments(ctx, media.ID, existing.ID); err != nil {
		return MediaUploadResult{}, false
	}
	if rollbackErr := h.retirePendingDirectUpload(ctx, &media); rollbackErr != nil {
		log.Printf("failed to retire deduplicated direct upload %s: %v", media.ID, rollbackErr)
		return MediaUploadResult{}, false
	}
	return mediaUploadResultFromAttachment(existing, true), true
}

// repairDimensionlessDirectUploadDuplicate prevents a newly validated image
// upload from resolving to a legacy ready row without usable dimensions.
// The uploaded bytes have already passed validation and are hash-identical to
// the existing row. Update its metadata before retiring the new reservation.
func (h *MediaHandler) repairDimensionlessDirectUploadDuplicate(
	ctx context.Context,
	existing *models.MediaAttachment,
	inspectedContent []byte,
) error {
	if !strings.HasPrefix(strings.ToLower(existing.MimeType), "image/") ||
		(existing.Width > 0 && existing.Height > 0) {
		return nil
	}
	if len(inspectedContent) == 0 {
		return fmt.Errorf("validated image bytes are unavailable")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(existing.MimeType, ";")[0]))
	config, err := decodeMediaImageConfig(mimeType, inspectedContent)
	width, height := config.Width, config.Height
	if err != nil || width <= 0 || height <= 0 {
		return fmt.Errorf("duplicate image dimensions are invalid")
	}
	_, err = h.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("width = ?", width).
		Set("height = ?", height).
		Set("aspect_ratio = ?", mediaAspectRatio(width, height)).
		Where("id = ? AND workspace_id = ? AND file_hash = ? AND processing_status = ?",
			existing.ID, existing.WorkspaceID, existing.FileHash, mediaReadyStatus).
		Exec(ctx)
	if err != nil {
		return err
	}
	if err := h.db.NewSelect().Model(existing).
		Where("id = ? AND workspace_id = ?", existing.ID, existing.WorkspaceID).Scan(ctx); err != nil {
		return err
	}
	if existing.ProcessingStatus != mediaReadyStatus || existing.Width <= 0 || existing.Height <= 0 {
		return fmt.Errorf("duplicate image is no longer publishable")
	}
	return nil
}

func directMediaUploadSupportsDeduplication(media models.MediaAttachment) bool {
	return mediaSourceSupportsDeduplication(media.Source) && media.AssetKind == "library"
}

func (h *MediaHandler) loadDirectMediaUpload(ctx context.Context, userID, workspaceID, mediaID string) (models.MediaAttachment, error) {
	var media models.MediaAttachment
	if strings.TrimSpace(mediaID) == "" {
		return media, huma.Error400BadRequest("media id is required")
	}
	if err := h.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return media, huma.Error404NotFound(errMediaNotFound)
		}
		return media, huma.Error500InternalServerError("failed to fetch media")
	}
	if media.WorkspaceID != workspaceID {
		return media, huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, workspaceID); err != nil {
		return media, err
	}
	if !directMediaUploadFinalized(media) &&
		media.ProcessingStatus != mediaReadyStatus &&
		media.ProcessingStatus != mediaProcessingStatus {
		return media, huma.Error400BadRequest("media upload session is not pending")
	}
	if media.StorageType != h.storage.Driver() {
		return media, huma.Error400BadRequest("media upload session belongs to a different storage driver")
	}
	return media, nil
}

func directMediaUploadFinalized(media models.MediaAttachment) bool {
	fileHash := strings.TrimSpace(media.FileHash)
	return media.ProcessingStatus == mediaReadyStatus ||
		(fileHash != "" && !strings.HasPrefix(fileHash, "pending:"))
}

func (h *MediaHandler) inspectDirectMediaUpload(ctx context.Context, media models.MediaAttachment) (mediaUploadInspection, error) {
	var inspection mediaUploadInspection
	sizeLimit := mediaUploadSizeLimit(media.AssetKind, media.OriginalFilename, media.MimeType)
	if media.Size <= 0 {
		return inspection, huma.Error400BadRequest("uploaded media object is empty")
	}
	if media.Size > sizeLimit {
		return inspection, huma.Error400BadRequest(mediaUploadSizeError(sizeLimit))
	}

	file, err := h.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return inspection, huma.Error500InternalServerError("failed to access uploaded media")
	}
	defer file.Close()

	if media.Size <= MaxBufferedMediaUploadBytes {
		content, readErr := io.ReadAll(io.LimitReader(file, sizeLimit+1))
		if readErr != nil {
			return inspection, huma.Error500InternalServerError("failed to read uploaded media")
		}
		inspection.Content = content
		inspection.Size = int64(len(content))
		if len(content) > 512 {
			inspection.Prefix = content[:512]
		} else {
			inspection.Prefix = content
		}
		hash := sha256.Sum256(content)
		inspection.FileHash = hex.EncodeToString(hash[:])
	} else {
		prefix := make([]byte, 512)
		prefixBytes, readErr := io.ReadFull(file, prefix)
		if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
			return inspection, huma.Error500InternalServerError("failed to read uploaded media")
		}
		prefix = prefix[:prefixBytes]
		hasher := sha256.New()
		_, _ = hasher.Write(prefix)
		remainingBytes, copyErr := io.Copy(hasher, io.LimitReader(file, sizeLimit-int64(prefixBytes)+1))
		if copyErr != nil {
			return inspection, huma.Error500InternalServerError("failed to read uploaded media")
		}
		inspection.Prefix = prefix
		inspection.Size = int64(prefixBytes) + remainingBytes
		inspection.FileHash = hex.EncodeToString(hasher.Sum(nil))
	}
	if inspection.Size > sizeLimit {
		return mediaUploadInspection{}, huma.Error400BadRequest(mediaUploadSizeError(sizeLimit))
	}
	if inspection.Size == 0 {
		return mediaUploadInspection{}, huma.Error400BadRequest("uploaded media object is empty")
	}
	if media.Size != inspection.Size {
		return mediaUploadInspection{}, huma.Error400BadRequest("uploaded media size does not match upload session")
	}
	return inspection, nil
}

func (h *MediaHandler) findDuplicateMedia(ctx context.Context, workspaceID, fileHash, mediaID string) (models.MediaAttachment, bool, error) {
	var existing models.MediaAttachment
	err := h.db.NewSelect().Model(&existing).
		Where("workspace_id = ? AND file_hash = ? AND id != ?", workspaceID, fileHash, mediaID).
		Where("(source = ? OR source = '' OR source IS NULL)", "upload").
		Where("(asset_kind = ? OR asset_kind = '' OR asset_kind IS NULL)", "library").
		Scan(ctx)
	if err == nil {
		return existing, true, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return existing, false, nil
	}
	return existing, false, huma.Error500InternalServerError("failed to check duplicate media")
}

// directUploadImageMetadata measures an uploaded image. A ready image with
// zero dimensions cannot be used in a Bluesky gallery, so such an upload is
// never finalized as publishable.
func (h *MediaHandler) directUploadImageMetadata(ctx context.Context, mediaID, mimeType string, content []byte) (int, int, Thumbnails, error) {
	if !strings.HasPrefix(mimeType, "image/") {
		return 0, 0, Thumbnails{}, nil
	}
	width, height, thumbnails, err := h.processImage(ctx, content, mediaID, mimeType)
	if err != nil {
		width, height = h.getImageDimensions(bytes.NewReader(content), mimeType)
	}
	if width <= 0 || height <= 0 {
		return 0, 0, thumbnails, errDirectUploadImageDimensions
	}
	return width, height, thumbnails, nil
}

func (h *MediaHandler) finalizeDirectMediaUploadRecord(ctx context.Context, media models.MediaAttachment, inspection mediaUploadInspection) (models.MediaAttachment, error) {
	mimeType := detectedMediaMimeType(inspection.Prefix, media.MimeType)
	width, height, thumbnails, err := h.directUploadImageMetadata(ctx, media.ID, mimeType, inspection.Content)
	if err != nil {
		return media, err
	}
	thumbsJSON := ""
	if encoded, err := json.Marshal(thumbnails); err == nil {
		thumbsJSON = string(encoded)
	}

	media.MimeType = mimeType
	media.ProcessingStatus = mediaReadyStatus
	media.ProcessingProgress = 100
	media.Size = inspection.Size
	media.FileHash = inspection.FileHash
	media.Width = width
	media.Height = height
	media.ThumbnailsJSON = thumbsJSON
	media.DominantType = dominantMediaType(mimeType)
	media.AspectRatio = mediaAspectRatio(width, height)
	media.AnalysisStatus = mediaanalysis.AnalysisStatusReady
	if mediaanalysis.IsTimeBased(mimeType) && h.video != nil {
		media.ProcessingStatus = mediaProcessingStatus
		media.ProcessingProgress = 0
		media.AnalysisStatus = mediaanalysis.AnalysisStatusPending
		media.AnalysisError = ""
	}
	h.applyPublicURLVerification(ctx, &media)
	err = h.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		// Take the same workspace lock as reservation and insert before the CAS.
		if _, err := tx.NewUpdate().Model((*models.Workspace)(nil)).Set("name = name").Where("id = ?", media.WorkspaceID).Exec(ctx); err != nil {
			return err
		}
		res, err := tx.NewUpdate().
			Model(&media).
			Column("mime_type", "processing_status", "processing_progress", "size", "file_hash", "width", "height", "duration_ms", "frame_rate", "thumbnails", "dominant_type", "aspect_ratio", "analysis_status", "analysis_error", "thumbnail_object_key", "public_url_ready", "public_url_checked_at", "public_url_status", "public_url_error").
			Where("id = ? AND workspace_id = ? AND file_hash LIKE ? AND processing_status IN (?, ?)", media.ID, media.WorkspaceID, "pending:%", mediaProcessingStatus, mediaUploadingStatus).
			Exec(ctx)
		if err != nil {
			return err
		}
		changed, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if changed == 0 {
			if err := tx.NewSelect().Model(&media).Where("id = ? AND workspace_id = ?", media.ID, media.WorkspaceID).Scan(ctx); err != nil {
				return err
			}
			if !directMediaUploadFinalized(media) {
				return huma.Error400BadRequest("media upload session is no longer pending")
			}
			return nil
		}
		return h.serializeMediaAdmission(ctx, tx, media, media.ID, true)
	})
	if err != nil {
		return media, mediaAdmissionHTTPError(err, "failed to finalize media upload")
	}

	if mediaanalysis.IsTimeBased(mimeType) && h.video != nil {
		h.enqueueVideoAnalysis(ctx, media.ID)
	}
	return media, nil
}

//nolint:gocyclo // Auth, session claiming, bounded streaming, storage cleanup, and retry recovery form one ordered transaction boundary.
func (h *MediaHandler) uploadMediaSessionContent(c echo.Context) error {
	userID, _ := c.Get(string(middleware.UserIDKey)).(string)
	mediaID := strings.TrimSpace(c.Param("id"))
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to load media upload session"})
	}
	if ok, err := h.userCanEditWorkspace(c.Request().Context(), media.WorkspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}
	if h.storage == nil || media.StorageType != h.storage.Driver() {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "media upload session does not use this instance's storage"})
	}
	if media.ProcessingStatus != mediaProcessingStatus {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "media upload session is not pending"})
	}
	if media.CreatedAt.IsZero() || time.Since(media.CreatedAt) > mediaUploadSessionTTL(media.Size) {
		h.markMediaUploadFailed(c.Request().Context(), media.ID)
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media upload session expired"})
	}

	sizeLimit := mediaUploadSizeLimit(media.AssetKind, media.OriginalFilename, media.MimeType)
	if media.Size <= 0 || media.Size > sizeLimit {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: mediaUploadSizeError(sizeLimit)})
	}
	if contentLength := c.Request().ContentLength; contentLength >= 0 && contentLength != media.Size {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "uploaded media size does not match upload session"})
	}
	ctx := c.Request().Context()
	claimResult, err := h.db.NewUpdate().
		Model(&media).
		Set("processing_status = ?", mediaUploadingStatus).
		Where("id = ? AND processing_status = ?", media.ID, mediaProcessingStatus).
		Exec(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to claim media upload session"})
	}
	claimed, err := claimResult.RowsAffected()
	if err != nil || claimed != 1 {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "media upload session is already in use"})
	}
	objectKey := filepath.Base(media.FilePath)
	cleanupFailedUpload := func() error {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), mediaUploadCleanupTimeout)
		defer cancelCleanup()
		result, err := h.db.NewUpdate().
			Model((*models.MediaAttachment)(nil)).
			Set("processing_status = ?", mediaProcessingStatus).
			Where("id = ? AND processing_status = ?", media.ID, mediaUploadingStatus).
			Exec(cleanupCtx)
		if err != nil {
			return err
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if updated != 1 {
			return fmt.Errorf("reset media upload session updated %d rows", updated)
		}
		deleteCtx, cancelDelete := context.WithTimeout(cleanupCtx, mediaUploadDeleteTimeout)
		defer cancelDelete()
		return h.storage.Delete(deleteCtx, objectKey)
	}

	counter := &countingReader{
		reader: io.LimitReader(c.Request().Body, sizeLimit+1),
	}
	savedPath, err := mediastore.SaveWithContentType(ctx, h.storage, objectKey, counter, media.MimeType)
	if err != nil {
		if cleanupErr := cleanupFailedUpload(); cleanupErr != nil {
			log.Printf("failed to roll back media upload session %s: %v", media.ID, cleanupErr)
		}
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to stream media upload"})
	}
	if counter.count > sizeLimit {
		if cleanupErr := cleanupFailedUpload(); cleanupErr != nil {
			log.Printf("failed to roll back media upload session %s: %v", media.ID, cleanupErr)
		}
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{fieldError: mediaUploadSizeError(sizeLimit)})
	}
	if counter.count != media.Size {
		if cleanupErr := cleanupFailedUpload(); cleanupErr != nil {
			log.Printf("failed to roll back media upload session %s: %v", media.ID, cleanupErr)
		}
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "uploaded media size does not match upload session"})
	}
	updateResult, err := h.db.NewUpdate().
		Model(&media).
		Set("file_path = ?, processing_status = ?", savedPath, mediaProcessingStatus).
		Where("id = ? AND processing_status = ?", media.ID, mediaUploadingStatus).
		Exec(c.Request().Context())
	if err != nil {
		if cleanupErr := cleanupFailedUpload(); cleanupErr != nil {
			log.Printf("failed to roll back media upload session %s: %v", media.ID, cleanupErr)
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to save media upload session"})
	}
	rowsAffected, err := updateResult.RowsAffected()
	if err != nil || rowsAffected != 1 {
		if cleanupErr := cleanupFailedUpload(); cleanupErr != nil {
			log.Printf("failed to roll back media upload session %s: %v", media.ID, cleanupErr)
		}
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "media upload session is no longer pending"})
	}
	return c.NoContent(http.StatusNoContent)
}
