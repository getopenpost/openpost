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
	"image"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/disintegration/imaging"
	"github.com/gen2brain/avif"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	echoMiddleware "github.com/labstack/echo/v4/middleware"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/imagethumbnail"
	"github.com/openpost/backend/internal/mediacodec/ico"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

type countingReader struct {
	reader io.Reader
	count  int64
}

func (r *countingReader) Read(buffer []byte) (int, error) {
	read, err := r.reader.Read(buffer)
	r.count += int64(read)
	return read, err
}

func (h *MediaHandler) deleteMediaFiles(ctx context.Context, media *models.MediaAttachment) error {
	if err := h.storage.Delete(ctx, filepath.Base(media.FilePath)); err != nil {
		return err
	}

	var thumbs Thumbnails
	if media.ThumbnailsJSON != "" {
		_ = json.Unmarshal([]byte(media.ThumbnailsJSON), &thumbs)
	}

	if thumbs.SM != "" {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, thumbs.SM)
	}
	if thumbs.MD != "" {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, thumbs.MD)
	}
	if media.ThumbnailObjectKey != "" {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, media.ThumbnailObjectKey)
	}

	return nil
}

func (h *MediaHandler) reconcileFailedMediaInsert(ctx context.Context, media *models.MediaAttachment) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), mediaUploadCleanupTimeout)
	defer cancel()
	result, err := h.db.NewDelete().Model(media).WherePK().Exec(cleanupCtx)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted > 1 {
		return fmt.Errorf("reconcile failed media insert deleted %d rows", deleted)
	}
	return h.deleteMediaFiles(cleanupCtx, media)
}

func (h *MediaHandler) rollbackMediaRecord(ctx context.Context, media *models.MediaAttachment) error {
	rollbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), mediaUploadCleanupTimeout)
	defer cancel()
	result, err := h.db.NewDelete().Model(media).WherePK().Exec(rollbackCtx)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted != 1 {
		return fmt.Errorf("roll back media record deleted %d rows", deleted)
	}
	return h.deleteMediaFiles(rollbackCtx, media)
}

func (h *MediaHandler) RegisterLegacyRoutes(e *echo.Echo) {
	singleUploadLimit := strconv.FormatInt(MaxMediaUploadBytes+512*1024, 10)
	batchUploadLimit := strconv.FormatInt((MaxBufferedMediaUploadBytes*10)+(10*1024*1024), 10)
	// Legacy upload routes support both web (JWT) and CLI (op_cli_...)
	// credentials via the unified Authenticator. AuthMiddleware cannot
	// be used here because these are raw Echo handlers, not Huma ops.
	uploadAuth := middleware.BearerMiddleware(h.authn)
	uploadSessionContentAuth := middleware.BearerMiddleware(
		h.authn,
		middleware.RESTOperationUploadMediaSessionContent,
	)
	e.POST("/api/v1/media/upload", h.uploadMedia, echoMiddleware.BodyLimit(singleUploadLimit), uploadAuth)
	e.POST("/api/v1/media/batch-upload", h.batchUploadMedia, echoMiddleware.BodyLimit(batchUploadLimit), uploadAuth)
	e.PUT(
		"/api/v1/media/upload-session/:id/content",
		h.uploadMediaSessionContent,
		echoMiddleware.BodyLimit(singleUploadLimit),
		uploadSessionContentAuth,
	)
	e.GET("/api/v1/media/metadata", h.mediaMetadata, uploadAuth)
	e.GET("/media/:id", h.serveMedia, h.optionalMediaAuth())
	e.HEAD("/media/:id", h.serveMedia, h.optionalMediaAuth())
	e.GET("/media/:id/thumb/:size", h.serveThumbnailSize, h.optionalMediaAuth())
	e.HEAD("/media/:id/thumb/:size", h.serveThumbnailSize, h.optionalMediaAuth())
	e.GET("/media/:id/poster", h.serveVideoPoster, h.optionalMediaAuth())
	e.HEAD("/media/:id/poster", h.serveVideoPoster, h.optionalMediaAuth())
}

// Multipart fields may follow the file. Bound parsing before FormValue can
// spool it, using the largest allowance the credential can legitimately use.
// Internal previews retain their existing buffered-media ceiling.
func (h *MediaHandler) boundLegacyUploadBody(c echo.Context, userID string, batch bool) error {
	ctx := c.Request().Context()
	var workspaceIDs []string
	if err := h.db.NewSelect().Model((*models.WorkspaceMember)(nil)).Column("workspace_id").Where("user_id = ? AND status = ? AND role IN (?)", userID, models.WorkspaceMemberStatusActive, bun.List([]string{models.WorkspaceRoleAdmin, models.WorkspaceRoleEditor})).Scan(ctx, &workspaceIDs); err != nil {
		return err
	}
	maximum := MaxMediaUploadBytes
	if batch {
		maximum = MaxBufferedMediaUploadBytes * 10
	}
	allowance := int64(0)
	hasAllowedWorkspace := false
	for _, workspaceID := range workspaceIDs {
		allowed, err := h.userCanEditWorkspace(ctx, workspaceID, userID)
		if err != nil {
			return err
		}
		if !allowed {
			continue
		}
		hasAllowedWorkspace = true
		remaining := maximum
		for _, metric := range []entitlements.LimitKey{entitlements.LimitMediaBytesStored, entitlements.LimitMediaBytesUploadedMonthly} {
			var current int64
			if metric == entitlements.LimitMediaBytesStored {
				current, err = medialifecycle.StoredBytes(ctx, h.db, workspaceID, "")
			} else {
				current, err = h.usage.CurrentMonthly(ctx, workspaceID, metric, time.Now().UTC())
			}
			if err != nil {
				return err
			}
			decision, err := h.quota.Check(ctx, entitlements.Request{WorkspaceID: workspaceID, Limit: metric, Current: current, Amount: 1})
			if err != nil {
				return err
			}
			if !decision.Unlimited {
				remaining = min(remaining, max(int64(0), decision.Limit-current))
			}
		}
		allowance = max(allowance, remaining)
	}
	if !hasAllowedWorkspace {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	allowance = max(allowance, MaxBufferedMediaUploadBytes)
	// Bound metadata and multipart framing too, independently of the media limit.
	const envelopeBytes = 512 * 1024
	capBytes := min(maximum, allowance) + envelopeBytes
	if c.Request().ContentLength > capBytes {
		return huma.NewError(http.StatusRequestEntityTooLarge, "upload exceeds available media capacity")
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, capBytes)
	err := c.Request().ParseMultipartForm(envelopeBytes)
	var sizeErr *http.MaxBytesError
	if errors.As(err, &sizeErr) {
		return huma.NewError(http.StatusRequestEntityTooLarge, "upload exceeds available media capacity")
	}
	return err
}

func (h *MediaHandler) uploadMedia(c echo.Context) error {
	userID := c.Get(string(middleware.UserIDKey)).(string)
	defer func() {
		if form := c.Request().MultipartForm; form != nil {
			_ = form.RemoveAll()
		}
	}()
	if err := h.boundLegacyUploadBody(c, userID, false); err != nil {
		status := http.StatusBadRequest
		if typed, ok := err.(huma.StatusError); ok {
			status = typed.GetStatus()
		}
		return c.JSON(status, map[string]string{fieldError: "upload exceeds available media capacity or has invalid multipart data"})
	}

	workspaceID := c.FormValue("workspace_id")
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: errWorkspaceIDRequired})
	}

	if ok, err := h.userCanEditWorkspace(c.Request().Context(), workspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "file is required"})
	}

	stockProvenance, err := parseStockMediaProvenance(c.FormValue("stock_provenance"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: err.Error()})
	}

	result, err := h.processUpload(c.Request().Context(), workspaceID, fileHeader, mediaUploadBytesInput{
		AltText:          c.FormValue("alt_text"),
		Source:           c.FormValue("source"),
		AssetKind:        c.FormValue("asset_kind"),
		RetentionClass:   c.FormValue("retention_class"),
		TagID:            c.FormValue("tag_id"),
		ParentMediaID:    c.FormValue("parent_media_id"),
		DesignDocumentID: c.FormValue("design_document_id"),
		DesignPageID:     c.FormValue("design_page_id"),
		StockProvenance:  stockProvenance,
	})
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: err.Error()})
	}

	return c.JSON(http.StatusOK, result)
}

func (h *MediaHandler) batchUploadMedia(c echo.Context) error {
	userID := c.Get(string(middleware.UserIDKey)).(string)
	defer func() {
		if form := c.Request().MultipartForm; form != nil {
			_ = form.RemoveAll()
		}
	}()
	if err := h.boundLegacyUploadBody(c, userID, true); err != nil {
		status := http.StatusBadRequest
		if typed, ok := err.(huma.StatusError); ok {
			status = typed.GetStatus()
		}
		return c.JSON(status, map[string]string{fieldError: "upload exceeds available media capacity or has invalid multipart data"})
	}

	workspaceID := c.FormValue("workspace_id")
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: errWorkspaceIDRequired})
	}

	if ok, err := h.userCanEditWorkspace(c.Request().Context(), workspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}

	form, err := c.MultipartForm()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to parse multipart form"})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "no files provided"})
	}

	if len(files) > 10 {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "max 10 files at once"})
	}

	results := []map[string]interface{}{}
	uploadErrors := []string{}

	for _, fileHeader := range files {
		result, err := h.processUpload(c.Request().Context(), workspaceID, fileHeader, mediaUploadBytesInput{})
		if err != nil {
			uploadErrors = append(uploadErrors, fileHeader.Filename+": "+err.Error())
			continue
		}
		results = append(results, result)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"uploaded": results,
		"errors":   uploadErrors,
	})
}

func (h *MediaHandler) processUpload(ctx context.Context, workspaceID string, fileHeader *multipart.FileHeader, metadata mediaUploadBytesInput) (map[string]interface{}, error) {
	file, err := fileHeader.Open()
	if err != nil {
		return nil, errors.New("failed to open file")
	}
	defer file.Close()

	metadata.WorkspaceID = workspaceID
	metadata.Filename = cleanUploadFilename(fileHeader.Filename)
	if metadata.Filename == "" {
		return nil, errors.New("filename is required")
	}
	metadata.DeclaredMimeType = fileHeader.Header.Get("Content-Type")
	metadata.Size = fileHeader.Size
	source, assetKind, err := normalizeMediaProvenance(metadata.Source, metadata.AssetKind)
	if err != nil {
		return nil, err
	}
	metadata.TagID, err = h.resolveMediaUploadTag(ctx, workspaceID, metadata.TagID, assetKind)
	if err != nil {
		return nil, errors.New(err.Error())
	}
	metadata.RetentionClass, err = medialifecycle.NormalizeRetention(metadata.RetentionClass, assetKind, metadata.TagID != "")
	if err != nil {
		return nil, err
	}
	if err := validateStockUploadProvenance(source, metadata.StockProvenance); err != nil {
		return nil, err
	}
	sizeLimit := mediaUploadSizeLimit(assetKind, metadata.Filename, metadata.DeclaredMimeType)
	if metadata.Size > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if metadata.Size > MaxBufferedMediaUploadBytes {
		return h.processStreamUpload(ctx, metadata, source, assetKind, file, sizeLimit)
	}

	content, err := io.ReadAll(io.LimitReader(file, sizeLimit+1))
	if err != nil {
		return nil, errors.New("failed to read file")
	}
	if int64(len(content)) > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	metadata.Content = content
	return h.processUploadBytes(ctx, metadata)
}

func (h *MediaHandler) processUploadStream(
	ctx context.Context,
	workspaceID string,
	filename string,
	declaredMimeType string,
	size int64,
	reader io.Reader,
	metadata mediaUploadBytesInput,
) (map[string]interface{}, error) {
	metadata.WorkspaceID = workspaceID
	metadata.Filename = cleanUploadFilename(filename)
	if metadata.Filename == "" {
		return nil, errors.New("filename is required")
	}
	metadata.DeclaredMimeType = declaredMimeType
	metadata.Size = size
	source, assetKind, err := normalizeMediaProvenance(metadata.Source, metadata.AssetKind)
	if err != nil {
		return nil, err
	}
	metadata.TagID, err = h.resolveMediaUploadTag(ctx, workspaceID, metadata.TagID, assetKind)
	if err != nil {
		return nil, errors.New(err.Error())
	}
	metadata.RetentionClass, err = medialifecycle.NormalizeRetention(metadata.RetentionClass, assetKind, metadata.TagID != "")
	if err != nil {
		return nil, err
	}
	if err := validateStockUploadProvenance(source, metadata.StockProvenance); err != nil {
		return nil, err
	}
	sizeLimit := mediaUploadSizeLimit(assetKind, metadata.Filename, metadata.DeclaredMimeType)
	if metadata.Size > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if assetKind == "brand_font" {
		content, err := io.ReadAll(io.LimitReader(reader, sizeLimit+1))
		if err != nil {
			return nil, errors.New("failed to read font")
		}
		if int64(len(content)) != metadata.Size {
			return nil, errors.New("uploaded media size does not match declared size")
		}
		metadata.Content = content
		return h.processUploadBytes(ctx, metadata)
	}
	return h.processStreamUpload(ctx, metadata, source, assetKind, reader, sizeLimit)
}

//nolint:gocyclo // Streaming validation, hashing, deduplication, analysis, persistence, and usage accounting form one ordered pipeline.
func (h *MediaHandler) processStreamUpload(
	ctx context.Context,
	input mediaUploadBytesInput,
	source string,
	assetKind string,
	reader io.Reader,
	sizeLimit int64,
) (map[string]interface{}, error) {
	input.Filename = cleanUploadFilename(input.Filename)
	if input.Filename == "" {
		return nil, errors.New("filename is required")
	}
	if input.Size <= 0 {
		return nil, errors.New("file size is invalid")
	}
	if input.Size > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if err := h.validateMediaProvenanceReferences(ctx, input.WorkspaceID, input.ParentMediaID, input.DesignDocumentID, input.DesignPageID); err != nil {
		return nil, errors.New(err.Error())
	}
	if !isInternalMediaAssetKind(assetKind) {
		if err := h.checkUploadQuota(ctx, input.WorkspaceID, input.Size); err != nil {
			return nil, err
		}
	}

	prefix := make([]byte, 512)
	prefixBytes, readErr := io.ReadFull(reader, prefix)
	if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return nil, errors.New("failed to read file")
	}
	prefix = prefix[:prefixBytes]
	if len(prefix) == 0 {
		return nil, errors.New("file is empty")
	}
	if err := validateMediaAssetContent(assetKind, input.Filename, input.DeclaredMimeType, prefix); err != nil {
		return nil, err
	}
	mimeType := detectedMediaMimeType(prefix, input.DeclaredMimeType)

	mediaID := uuid.New().String()
	objectKey := mediaID + filepath.Ext(input.Filename)
	counter := &countingReader{reader: io.MultiReader(bytes.NewReader(prefix), reader)}
	hasher := sha256.New()
	limited := io.LimitReader(counter, sizeLimit+1)
	savedPath, err := mediastore.SaveWithContentType(ctx, h.storage, objectKey, io.TeeReader(limited, hasher), mimeType)
	if err != nil {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
		return nil, errors.New("failed to save media")
	}
	if counter.count > sizeLimit {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if counter.count != input.Size {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
		return nil, errors.New("uploaded media size does not match declared size")
	}
	if strings.HasPrefix(mimeType, "image/") {
		stored, openErr := h.storage.Open(ctx, objectKey)
		if openErr != nil {
			_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
			return nil, errors.New("failed to read uploaded image")
		}
		content, readErr := io.ReadAll(io.LimitReader(stored, MaxBufferedMediaUploadBytes+1))
		_ = stored.Close()
		if readErr != nil {
			_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
			return nil, errors.New("failed to read uploaded image")
		}
		if int64(len(content)) > MaxBufferedMediaUploadBytes {
			_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
			return nil, errors.New("image file size exceeds 50MB limit")
		}
		if err := validateMediaImageContent(mimeType, content); err != nil {
			_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
			return nil, err
		}
	}
	fileHash := hex.EncodeToString(hasher.Sum(nil))
	if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
		if existing, found, duplicateErr := h.findDuplicateMedia(ctx, input.WorkspaceID, fileHash, mediaID); duplicateErr != nil {
			_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
			return nil, duplicateErr
		} else if found {
			if err := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); err != nil {
				_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
				return nil, err
			}
			if err := h.addMediaTag(ctx, input.TagID, existing.ID); err != nil {
				_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
				return nil, errors.New(err.Error())
			}
			_ = mediastore.DeleteForCleanup(ctx, h.storage, objectKey)
			return mediaUploadMap(existing, true), nil
		}
	}

	media := &models.MediaAttachment{
		ID:                 mediaID,
		WorkspaceID:        input.WorkspaceID,
		FilePath:           savedPath,
		StorageType:        h.storage.Driver(),
		MimeType:           mimeType,
		ProcessingStatus:   mediaReadyStatus,
		ProcessingProgress: 100,
		Size:               counter.count,
		OriginalFilename:   input.Filename,
		FileHash:           fileHash,
		AltText:            input.AltText,
		Source:             source,
		AssetKind:          assetKind,
		RetentionClass:     input.RetentionClass,
		ParentMediaID:      strings.TrimSpace(input.ParentMediaID),
		DesignDocumentID:   strings.TrimSpace(input.DesignDocumentID),
		DesignPageID:       strings.TrimSpace(input.DesignPageID),
		DominantType:       dominantMediaType(mimeType),
		AnalysisStatus:     mediaanalysis.AnalysisStatusReady,
		LastUsedAt:         time.Now().UTC(),
	}
	if mediaanalysis.IsTimeBased(mimeType) && h.video != nil {
		media.ProcessingStatus = mediaProcessingStatus
		media.ProcessingProgress = 0
		media.AnalysisStatus = mediaanalysis.AnalysisStatusPending
	}

	if err := h.insertAdmittedMedia(ctx, media); err != nil {
		if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
			if existing, found, duplicateErr := h.findDuplicateMedia(ctx, input.WorkspaceID, fileHash, media.ID); duplicateErr == nil && found {
				if cleanupErr := h.reconcileFailedMediaInsert(ctx, media); cleanupErr != nil {
					log.Printf("failed to reconcile deduplicated streaming upload %s: %v", media.ID, cleanupErr)
					return nil, errors.New("failed to reconcile media record")
				}
				if provenanceErr := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); provenanceErr != nil {
					return nil, provenanceErr
				}
				if tagErr := h.addMediaTag(ctx, input.TagID, existing.ID); tagErr != nil {
					return nil, errors.New(tagErr.Error())
				}
				return mediaUploadMap(existing, true), nil
			}
		}
		if cleanupErr := h.reconcileFailedMediaInsert(ctx, media); cleanupErr != nil {
			log.Printf("failed to reconcile streaming media insertion failure for %s: %v", media.ID, cleanupErr)
		}
		return nil, errors.New("failed to save media record")
	}
	if input.OnCreated != nil {
		input.OnCreated(*media)
	}
	if err := h.addMediaTag(ctx, input.TagID, media.ID); err != nil {
		if rollbackErr := h.rollbackMediaRecord(ctx, media); rollbackErr != nil {
			log.Printf("failed to roll back streaming media after tag assignment failure for %s: %v", media.ID, rollbackErr)
		}
		return nil, errors.New(err.Error())
	}
	if err := h.persistStockMediaProvenance(ctx, media.ID, input.StockProvenance); err != nil {
		if rollbackErr := h.rollbackMediaRecord(ctx, media); rollbackErr != nil {
			log.Printf("failed to roll back streaming media after provenance persistence failure for %s: %v", media.ID, rollbackErr)
		}
		return nil, errors.New("failed to save stock media provenance")
	}
	if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, media); err != nil {
		log.Printf("failed to persist public URL verification for media %s: %v", media.ID, err)
	}
	if mediaanalysis.IsTimeBased(mimeType) && h.video != nil {
		h.enqueueVideoAnalysis(ctx, media.ID)
	}

	return mediaUploadMap(*media, false), nil
}

//nolint:gocyclo // Upload validation, analysis, storage, and deduplication form one ordered pipeline.
func (h *MediaHandler) processUploadBytes(ctx context.Context, input mediaUploadBytesInput) (map[string]interface{}, error) {
	input.Filename = cleanUploadFilename(input.Filename)
	if input.Filename == "" {
		return nil, errors.New("filename is required")
	}
	if input.Size < 0 {
		return nil, errors.New("file size is invalid")
	}
	if int64(len(input.Content)) != input.Size {
		input.Size = int64(len(input.Content))
	}

	source, assetKind, err := normalizeMediaProvenance(input.Source, input.AssetKind)
	if err != nil {
		return nil, err
	}
	input.TagID, err = h.resolveMediaUploadTag(ctx, input.WorkspaceID, input.TagID, assetKind)
	if err != nil {
		return nil, errors.New(err.Error())
	}
	input.RetentionClass, err = medialifecycle.NormalizeRetention(input.RetentionClass, assetKind, input.TagID != "")
	if err != nil {
		return nil, err
	}
	sizeLimit := mediaUploadSizeLimit(assetKind, input.Filename, input.DeclaredMimeType)
	if input.Size > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if err := validateMediaAssetContent(assetKind, input.Filename, input.DeclaredMimeType, input.Content); err != nil {
		return nil, err
	}
	if err := h.validateMediaProvenanceReferences(ctx, input.WorkspaceID, input.ParentMediaID, input.DesignDocumentID, input.DesignPageID); err != nil {
		return nil, errors.New(err.Error())
	}
	hash := sha256.Sum256(input.Content)
	fileHash := hex.EncodeToString(hash[:])

	mimeType := http.DetectContentType(input.Content)
	if strings.HasPrefix(mimeType, defaultMediaMimeType) {
		mimeType = input.DeclaredMimeType
		if mimeType == "" {
			mimeType = defaultMediaMimeType
		}
	}

	if input.PreparedImage != nil {
		if source != "image_fit" || !input.PreparedImage.Matches(input.Content, mimeType) {
			return nil, errors.New("invalid image preparation receipt")
		}
	} else if err := validateMediaImageContent(mimeType, input.Content); err != nil {
		return nil, err
	}

	var existing models.MediaAttachment
	if input.StableID != "" {
		if _, err := uuid.Parse(input.StableID); err != nil || source != "image_generation" || input.TagID != "" || input.StockProvenance != nil {
			return nil, errors.New("invalid durable image import")
		}
		err := h.db.NewSelect().Model(&existing).Where("id = ?", input.StableID).Scan(ctx)
		if err == nil {
			if existing.WorkspaceID != input.WorkspaceID || existing.Source != source || existing.FileHash != fileHash || !existing.TrashedAt.IsZero() {
				return nil, errors.New("durable image import conflicts with stored media")
			}
			return mediaUploadMap(existing, true), nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
		err = h.db.NewSelect().Model(&existing).
			Where("workspace_id = ? AND file_hash = ? AND (asset_kind = ? OR asset_kind = '' OR asset_kind IS NULL)", input.WorkspaceID, fileHash, "library").
			Scan(ctx)
		if err == nil {
			if err := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); err != nil {
				return nil, err
			}
			if err := h.addMediaTag(ctx, input.TagID, existing.ID); err != nil {
				return nil, errors.New(err.Error())
			}
			return mediaUploadMap(existing, true), nil
		}
	}
	if !isInternalMediaAssetKind(assetKind) {
		if err := h.checkUploadQuota(ctx, input.WorkspaceID, input.Size); err != nil {
			return nil, err
		}
	}

	mediaID := input.StableID
	if mediaID == "" {
		mediaID = uuid.NewString()
	}
	ext := filepath.Ext(input.Filename)
	filename := mediaID + ext

	savedPath, err := mediastore.SaveWithContentType(ctx, h.storage, filename, bytes.NewReader(input.Content), mimeType)
	if err != nil {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, filename)
		return nil, errors.New("failed to save media")
	}

	media := &models.MediaAttachment{
		ID:                 mediaID,
		WorkspaceID:        input.WorkspaceID,
		FilePath:           savedPath,
		StorageType:        h.storage.Driver(),
		MimeType:           mimeType,
		ProcessingStatus:   mediaReadyStatus,
		ProcessingProgress: 100,
		Size:               input.Size,
		OriginalFilename:   input.Filename,
		FileHash:           fileHash,
		AltText:            input.AltText,
		Source:             source,
		AssetKind:          assetKind,
		RetentionClass:     input.RetentionClass,
		ParentMediaID:      strings.TrimSpace(input.ParentMediaID),
		DesignDocumentID:   strings.TrimSpace(input.DesignDocumentID),
		DesignPageID:       strings.TrimSpace(input.DesignPageID),
		LastUsedAt:         time.Now().UTC(),
	}

	width, height := 0, 0
	var thumbnails Thumbnails

	if strings.HasPrefix(mimeType, "image/") {
		if input.PreparedImage != nil {
			width, height = input.PreparedImage.Width, input.PreparedImage.Height
			thumbnails = h.persistPreparedThumbnails(ctx, mediaID, input.PreparedImage)
		} else {
			width, height, thumbnails, err = h.processImage(ctx, input.Content, mediaID, mimeType)
			if err != nil {
				width, height = h.getImageDimensions(bytes.NewReader(input.Content), mimeType)
			}
		}
		media.Width = width
		media.Height = height
		if thumbsJSON, err := json.Marshal(thumbnails); err == nil {
			media.ThumbnailsJSON = string(thumbsJSON)
		}
	}
	media.DominantType = dominantMediaType(mimeType)
	media.AspectRatio = mediaAspectRatio(media.Width, media.Height)
	media.AnalysisStatus = mediaanalysis.AnalysisStatusReady
	if mediaanalysis.IsTimeBased(mimeType) && h.video != nil {
		media.ProcessingStatus = mediaProcessingStatus
		media.ProcessingProgress = 0
		media.AnalysisStatus = mediaanalysis.AnalysisStatusPending
	}

	insertErr := h.insertAdmittedMedia(ctx, media)
	if insertErr != nil {
		if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
			if existing, found, duplicateErr := h.findDuplicateMedia(ctx, input.WorkspaceID, fileHash, media.ID); duplicateErr == nil && found {
				if cleanupErr := h.reconcileFailedMediaInsert(ctx, media); cleanupErr != nil {
					log.Printf("failed to reconcile deduplicated upload %s: %v", media.ID, cleanupErr)
					return nil, errors.New("failed to reconcile media record")
				}
				if provenanceErr := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); provenanceErr != nil {
					return nil, provenanceErr
				}
				if tagErr := h.addMediaTag(ctx, input.TagID, existing.ID); tagErr != nil {
					return nil, errors.New(tagErr.Error())
				}
				return mediaUploadMap(existing, true), nil
			}
		}
		if cleanupErr := h.reconcileFailedMediaInsert(ctx, media); cleanupErr != nil {
			log.Printf("failed to reconcile media insertion failure for %s: %v", media.ID, cleanupErr)
		}
		return nil, errors.New("failed to save media record")
	}
	if input.OnCreated != nil {
		input.OnCreated(*media)
	}
	if err := h.addMediaTag(ctx, input.TagID, media.ID); err != nil {
		if rollbackErr := h.rollbackMediaRecord(ctx, media); rollbackErr != nil {
			log.Printf("failed to roll back media after tag assignment failure for %s: %v", media.ID, rollbackErr)
		}
		return nil, errors.New(err.Error())
	}
	if err := h.persistStockMediaProvenance(ctx, media.ID, input.StockProvenance); err != nil {
		if rollbackErr := h.rollbackMediaRecord(ctx, media); rollbackErr != nil {
			log.Printf("failed to roll back media after provenance persistence failure for %s: %v", media.ID, rollbackErr)
		}
		return nil, errors.New("failed to save stock media provenance")
	}
	if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, media); err != nil {
		log.Printf("failed to persist public URL verification for media %s: %v", media.ID, err)
	}
	if mediaanalysis.IsTimeBased(mimeType) {
		h.enqueueVideoAnalysis(ctx, media.ID)
	}

	return mediaUploadMap(*media, false), nil
}

func mediaAdmissionHTTPError(err error, detail string) error {
	var statusError huma.StatusError
	if errors.As(err, &statusError) {
		return err
	}
	if errors.Is(err, usage.ErrQuotaExceeded) {
		return huma.Error400BadRequest("media quota exceeded")
	}
	return huma.Error500InternalServerError(detail)
}

// serializeMediaAdmission locks the workspace in both supported databases before
// observing its stored bytes. Pending sessions reserve their declared size.
func (h *MediaHandler) serializeMediaAdmission(ctx context.Context, db bun.IDB, media models.MediaAttachment, excludeID string, meter bool) error {
	if isInternalMediaAssetKind(media.AssetKind) {
		return nil
	}
	if _, err := db.NewUpdate().Model((*models.Workspace)(nil)).Set("name = name").Where("id = ?", media.WorkspaceID).Exec(ctx); err != nil {
		return err
	}
	stored, err := medialifecycle.StoredBytes(ctx, db, media.WorkspaceID, excludeID)
	if err != nil {
		return err
	}
	decision, err := entitlements.CheckWithDB(ctx, h.quota, db, entitlements.Request{WorkspaceID: media.WorkspaceID, Limit: entitlements.LimitMediaBytesStored, Current: stored, Amount: media.Size})
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return usage.ErrQuotaExceeded
	}
	if !meter {
		return nil
	}
	decision, err = entitlements.CheckWithDB(ctx, h.quota, db, entitlements.Request{WorkspaceID: media.WorkspaceID, Limit: entitlements.LimitMediaBytesUploadedMonthly, Amount: media.Size})
	if err != nil {
		return err
	}
	_, err = usage.IncrementMonthlyLimitedInTransaction(ctx, db, media.WorkspaceID, entitlements.LimitMediaBytesUploadedMonthly, media.Size, time.Now().UTC(), decision)
	return err
}

func (h *MediaHandler) insertAdmittedMedia(ctx context.Context, media *models.MediaAttachment) error {
	return h.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := h.serializeMediaAdmission(ctx, tx, *media, "", true); err != nil {
			return err
		}
		_, err := tx.NewInsert().Model(media).Exec(ctx)
		return err
	})
}

func (h *MediaHandler) checkUploadQuota(ctx context.Context, workspaceID string, size int64) error {
	return h.checkUploadQuotaExcludingMedia(ctx, workspaceID, size, "")
}

func (h *MediaHandler) checkUploadQuotaExcludingMedia(ctx context.Context, workspaceID string, size int64, excludeMediaID string) error {
	uploaded, err := h.usage.CurrentMonthly(ctx, workspaceID, entitlements.LimitMediaBytesUploadedMonthly, time.Now().UTC())
	if err != nil {
		return errors.New("failed to load upload usage")
	}
	if err := h.checkQuota(ctx, workspaceID, entitlements.LimitMediaBytesUploadedMonthly, uploaded, size); err != nil {
		return err
	}

	stored, err := medialifecycle.StoredBytes(ctx, h.db, workspaceID, excludeMediaID)
	if err != nil {
		return errors.New("failed to load stored media usage")
	}
	return h.checkQuota(ctx, workspaceID, entitlements.LimitMediaBytesStored, stored, size)
}

func (h *MediaHandler) checkQuota(ctx context.Context, workspaceID string, limit entitlements.LimitKey, current, amount int64) error {
	decision, err := h.quota.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       limit,
		Current:     current,
		Amount:      amount,
	})
	if err != nil {
		return errors.New("failed to check quota")
	}
	if !decision.Allowed {
		if decision.Reason != "" {
			return errors.New(decision.Reason)
		}
		return errors.New("quota exceeded")
	}
	return nil
}

func (h *MediaHandler) processImage(ctx context.Context, content []byte, mediaID, mimeType string) (int, int, Thumbnails, error) {
	reader := bytes.NewReader(content)

	var img image.Image
	var err error

	switch strings.ToLower(mimeType) {
	case "image/x-icon", "image/vnd.microsoft.icon":
		img, err = ico.Decode(content)
	case "image/avif":
		img, err = avif.Decode(reader)
	case "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/tiff", "image/bmp":
		img, err = imaging.Decode(reader)
	default:
		return 0, 0, Thumbnails{}, errors.New("unsupported image format")
	}

	if err != nil {
		return 0, 0, Thumbnails{}, err
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	thumbnails := Thumbnails{}
	thumbFormat := imaging.JPEG
	thumbExtension := ".jpg"
	thumbContentType := "image/jpeg"
	if imageHasTransparency(img) {
		thumbFormat = imaging.PNG
		thumbExtension = ".png"
		thumbContentType = "image/png"
	}

	smThumb := imagethumbnail.Square(img, ThumbnailSizeSM)
	smFilename := "sm_" + mediaID + thumbExtension
	if err := h.saveThumbnail(ctx, smFilename, smThumb, thumbFormat, thumbContentType); err == nil {
		thumbnails.SM = smFilename
	}

	mdThumb := imagethumbnail.Square(img, ThumbnailSizeMD)
	mdFilename := "md_" + mediaID + thumbExtension
	if err := h.saveThumbnail(ctx, mdFilename, mdThumb, thumbFormat, thumbContentType); err == nil {
		thumbnails.MD = mdFilename
	}

	return width, height, thumbnails, nil
}

// imageHasTransparency decides whether a thumbnail needs PNG encoding. JPEG
// would flatten transparent uploads onto black, so transparency has to survive
// into every derived size.
func imageHasTransparency(img image.Image) bool {
	opaque, ok := img.(interface{ Opaque() bool })
	return ok && !opaque.Opaque()
}

func thumbnailContentType(filename string) string {
	if strings.EqualFold(filepath.Ext(filename), ".png") {
		return "image/png"
	}
	return "image/jpeg"
}

func (h *MediaHandler) saveThumbnail(ctx context.Context, filename string, img image.Image, format imaging.Format, contentType string) error {
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, format); err != nil {
		return err
	}
	if _, err := mediastore.SaveWithContentType(ctx, h.storage, filename, &buf, contentType); err != nil {
		_ = mediastore.DeleteForCleanup(ctx, h.storage, filename)
		return err
	}
	return nil
}

func (h *MediaHandler) getImageDimensions(reader io.Reader, _ string) (int, int) {
	config, _, err := image.DecodeConfig(reader)
	if err != nil {
		return 0, 0
	}
	return config.Width, config.Height
}
