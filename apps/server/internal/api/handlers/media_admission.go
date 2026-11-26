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
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/disintegration/imaging"
	"github.com/gen2brain/avif"
	"github.com/openpost/backend/internal/mediacodec/ico"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/themes"
	"github.com/uptrace/bun"
)

func cleanUploadFilename(filename string) string {
	filename = strings.ToValidUTF8(filename, "�")
	filename = strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/"))
	if filename == "" {
		return ""
	}
	filename = filepath.Base(filename)
	if filename == "." || filename == "/" {
		return ""
	}
	return filename
}

func mediaUploadSizeLimit(assetKind, filename, mimeType string) int64 {
	if assetKind == "brand_font" {
		return MaxBrandFontUploadBytes
	}
	if isVideoUpload(filename, mimeType) {
		return MaxMediaUploadBytes
	}
	return MaxBufferedMediaUploadBytes
}

func isVideoUpload(filename, mimeType string) bool {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "video/") {
		return true
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".mp4", ".mov", ".m4v", ".webm":
		return true
	default:
		return false
	}
}

func mediaUploadSizeError(limit int64) string {
	switch limit {
	case MaxMediaUploadBytes:
		return "video file size exceeds 16 GiB limit"
	case MaxBrandFontUploadBytes:
		return "brand fonts must be 10MB or smaller"
	default:
		return "file size exceeds 50MB limit"
	}
}

func dominantMediaType(mimeType string) string {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	default:
		return "other"
	}
}

func mediaAspectRatio(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	gcd := greatestCommonDivisor(width, height)
	return strconv.Itoa(width/gcd) + ":" + strconv.Itoa(height/gcd)
}

func greatestCommonDivisor(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}

func (h *MediaHandler) enqueueVideoAnalysis(ctx context.Context, mediaID string) {
	if h.video == nil {
		log.Printf("video analysis service is unavailable for media %s", mediaID)
		return
	}
	if err := h.video.EnqueueAnalysis(ctx, mediaID); err != nil {
		log.Printf("failed to enqueue video analysis for media %s: %v", mediaID, err)
	}
}

func (h *MediaHandler) applyPublicURLVerification(ctx context.Context, media *models.MediaAttachment) {
	if h.publicMedia == nil {
		h.publicMedia = publicurl.NewMediaVerifier("", h.storage, h.signer)
	}
	applyPublicMediaResult(media, h.publicMedia.Verify(ctx, *media))
}

func mediaPosterURL(media models.MediaAttachment) string {
	if media.ThumbnailObjectKey == "" {
		return ""
	}
	return "/media/" + media.ID + "/poster"
}

func formatMediaTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func detectedMediaMimeType(content []byte, fallback string) string {
	mimeType := http.DetectContentType(content)
	if declared := declaredOggMediaMimeType(mimeType, fallback); declared != "" {
		return declared
	}
	if declared := declaredM4AMediaMimeType(content, mimeType, fallback); declared != "" {
		return declared
	}
	if !strings.HasPrefix(mimeType, defaultMediaMimeType) {
		return mimeType
	}
	if fallback != "" {
		return fallback
	}
	return defaultMediaMimeType
}

// declaredOggMediaMimeType keeps the browser's audio/ogg or video/ogg
// declaration for an upload the sniffer names application/ogg. The sniffer
// cannot tell Ogg audio from Ogg video, and application/ogg is neither
// analysed as video nor presented as audio.
func declaredOggMediaMimeType(sniffed, declared string) string {
	if sniffed != "application/ogg" {
		return ""
	}
	declared = strings.ToLower(strings.TrimSpace(strings.Split(declared, ";")[0]))
	if declared == "audio/ogg" || declared == "video/ogg" {
		return declared
	}
	return ""
}

// declaredM4AMediaMimeType keeps the browser's audio declaration for an
// upload the sniffer names video/mp4 when its ISO BMFF major brand is M4A.
// The sniffer names every brand that lists mp4 video/mp4, and a stored
// video/mp4 would make the audio upload a video everywhere downstream.
func declaredM4AMediaMimeType(content []byte, sniffed, declared string) string {
	if sniffed != "video/mp4" || len(content) < 12 || string(content[4:12]) != "ftypM4A " {
		return ""
	}
	declared = strings.ToLower(strings.TrimSpace(strings.Split(declared, ";")[0]))
	switch declared {
	case "audio/x-m4a", "audio/m4a", "audio/mp4":
		return declared
	}
	return ""
}

// decodeMediaImageConfig reads image dimensions with the decoder admission
// uses for the declared type. ICO keeps its dedicated seekable driver.
func decodeMediaImageConfig(mimeType string, content []byte) (image.Config, error) {
	switch mimeType {
	case "image/x-icon", "image/vnd.microsoft.icon":
		return ico.DecodeConfig(content)
	case "image/avif":
		return avif.DecodeConfig(bytes.NewReader(content))
	default:
		config, _, err := image.DecodeConfig(bytes.NewReader(content))
		return config, err
	}
}

func validateMediaImageContent(mimeType string, content []byte) error {
	if !strings.HasPrefix(mimeType, "image/") {
		return nil
	}
	config, err := decodeMediaImageConfig(mimeType, content)
	if err != nil {
		return errors.New("image file could not be decoded")
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width) > mediaUploadMaxImagePixels/int64(config.Height) {
		return fmt.Errorf("image cannot exceed %d pixels", mediaUploadMaxImagePixels)
	}
	// Keep the seekable reader for ICO; its directory offsets must not cause
	// allocation from untrusted entry-size fields before pixel validation.
	switch mimeType {
	case "image/x-icon", "image/vnd.microsoft.icon":
		_, err = ico.Decode(content)
	case "image/avif":
		_, err = avif.Decode(bytes.NewReader(content))
	default:
		_, err = imaging.Decode(bytes.NewReader(content))
	}
	if err != nil {
		return errors.New("image file could not be decoded")
	}
	return nil
}

func validateMediaAssetContent(assetKind, filename, declaredMimeType string, content []byte) error {
	if isSVGMediaUpload(filename, declaredMimeType, content) {
		return errors.New("SVG upload could not be processed")
	}
	if err := validateMediaUploadDeclaration(filename, declaredMimeType); err != nil {
		return err
	}
	if activeMediaDocumentType(http.DetectContentType(content)) {
		return errors.New("HTML and XML documents are not supported media")
	}
	if assetKind == "brand_font" {
		return validateBrandFontAsset(filename, declaredMimeType, content)
	}
	return checkDeclaredMimeMatchesSniffed(declaredMimeType, content)
}

func validateBrandFontAsset(filename, declaredMimeType string, content []byte) error {
	if int64(len(content)) > MaxBrandFontUploadBytes {
		return errors.New("brand fonts must be 10MB or smaller")
	}
	extension := strings.ToLower(filepath.Ext(filename))
	var formatName string
	var validSignature bool
	var allowedMimeTypes []string
	switch extension {
	case ".woff2":
		formatName = "WOFF2"
		validSignature = len(content) >= 4 && bytes.Equal(content[:4], []byte{'w', 'O', 'F', '2'})
		allowedMimeTypes = []string{"font/woff2"}
	case ".ttf":
		formatName = "TTF"
		validSignature = len(content) >= 4 &&
			(bytes.Equal(content[:4], []byte{0x00, 0x01, 0x00, 0x00}) ||
				bytes.Equal(content[:4], []byte{'t', 'r', 'u', 'e'}))
		allowedMimeTypes = []string{"font/ttf", "font/sfnt", "application/x-font-ttf", "application/font-sfnt"}
	case ".otf":
		formatName = "OTF"
		validSignature = len(content) >= 4 && bytes.Equal(content[:4], []byte{'O', 'T', 'T', 'O'})
		allowedMimeTypes = []string{"font/otf", "font/sfnt", "application/x-font-opentype", "application/font-sfnt"}
	default:
		return errors.New("brand fonts must use a .woff2, .ttf, or .otf extension")
	}
	if !validSignature {
		return fmt.Errorf("brand font content is not a valid %s file", formatName)
	}
	if declaredMimeType != "" &&
		!strings.EqualFold(declaredMimeType, defaultMediaMimeType) &&
		!slices.ContainsFunc(allowedMimeTypes, func(candidate string) bool {
			return strings.EqualFold(declaredMimeType, candidate)
		}) {
		return fmt.Errorf("brand font MIME type does not match the %s file", formatName)
	}
	if err := themes.ValidateFontContent(content, strings.TrimPrefix(extension, ".")); err != nil {
		return fmt.Errorf("brand font content is not a valid %s file: %w", formatName, err)
	}

	return nil
}

var mediaMimePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$`)

// validateMediaUploadDeclaration is a pure pre-check on the declared upload
// fields. It runs before any byte is stored so malformed declarations fail
// fast with a coded message instead of surfacing later as a storage error.
func validateMediaUploadDeclaration(filename, declaredMimeType string) error {
	if strings.TrimSpace(filename) == "" {
		return errors.New("filename is required")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(declaredMimeType, ";")[0]))
	if mimeType == "" || mimeType == defaultMediaMimeType {
		return nil
	}
	if !mediaMimePattern.MatchString(mimeType) {
		return fmt.Errorf("media MIME type %q is not a valid type/subtype value", declaredMimeType)
	}
	if activeMediaDocumentType(mimeType) {
		return errors.New("HTML and XML documents are not supported media")
	}
	return nil
}

// checkDeclaredMimeMatchesSniffed rejects uploads whose bytes sniff as a
// different top-level type than declared. Subtype differences stay allowed
// (transcodes and aliases), and generic text/plain and octet-stream sniffs
// stay allowed: they are the sniffer's fallback for unknown binaries such
// as device captures and container formats it cannot name. A specific sniff
// (image, video, audio, html) that contradicts the declaration is a
// polyglot the pipeline must not silently adopt.
func checkDeclaredMimeMatchesSniffed(declaredMimeType string, content []byte) error {
	if len(content) == 0 {
		return nil
	}
	declared := strings.ToLower(strings.TrimSpace(strings.Split(declaredMimeType, ";")[0]))
	if declared == "" || declared == defaultMediaMimeType {
		return nil
	}
	sniffed := http.DetectContentType(content)
	if strings.HasPrefix(sniffed, defaultMediaMimeType) ||
		strings.HasPrefix(sniffed, "text/plain") {
		return nil
	}
	declaredTop, _, _ := strings.Cut(declared, "/")
	sniffedTop, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(strings.Split(sniffed, ";")[0])), "/")
	if declaredTop != sniffedTop && !sharedAudioVideoContainer(declared, sniffed) {
		return fmt.Errorf("media content does not match the declared MIME type")
	}
	return nil
}

// sharedAudioVideoContainerSubtypes maps a declared or sniffed subtype to the
// container it names. The sniffer names every ISO BMFF brand video/mp4 and
// every Ogg page application/ogg, while browsers declare .m4a as audio/x-m4a
// and .ogg, .oga and .opus as audio/ogg.
var sharedAudioVideoContainerSubtypes = map[string]string{
	"3gpp":       "3gpp",
	"3gpp2":      "3gpp2",
	"matroska":   "matroska",
	"x-matroska": "x-matroska",
	"mp4":        "mp4",
	"m4a":        "mp4",
	"x-m4a":      "mp4",
	"ogg":        "ogg",
	"quicktime":  "quicktime",
	"webm":       "webm",
}

func sharedAudioVideoContainer(declared, sniffed string) bool {
	declaredTop, declaredSubtype, _ := strings.Cut(declared, "/")
	sniffedTop, sniffedSubtype, _ := strings.Cut(sniffed, "/")
	if (declaredTop != "audio" && declaredTop != "video") ||
		(sniffedTop != "audio" && sniffedTop != "video" && sniffed != "application/ogg") {
		return false
	}
	container, ok := sharedAudioVideoContainerSubtypes[declaredSubtype]
	return ok && container == sharedAudioVideoContainerSubtypes[sniffedSubtype]
}

func isSVGMediaUpload(filename, declaredMimeType string, content []byte) bool {
	if strings.EqualFold(strings.TrimSpace(declaredMimeType), "image/svg+xml") ||
		strings.EqualFold(filepath.Ext(strings.TrimSpace(filename)), ".svg") {
		return true
	}
	// Binary media may contain SVG-like bytes in samples or metadata. Only
	// inspect textual or unknown content for an undeclared SVG document.
	detected := http.DetectContentType(content)
	if !strings.HasPrefix(detected, "text/") && detected != "application/octet-stream" {
		return false
	}
	normalized := bytes.ToLower(bytes.TrimSpace(content))
	return bytes.Contains(normalized, []byte("<svg"))
}

func (h *MediaHandler) markMediaUploadFailed(ctx context.Context, mediaID string) {
	_, _ = h.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_status = ?", mediaFailedStatus).
		Where("id = ? AND file_hash LIKE ?", mediaID, "pending:%").
		Exec(ctx)
}

func mediaUploadResultFromAttachment(media models.MediaAttachment, deduped bool) MediaUploadResult {
	return MediaUploadResult{
		ID:    media.ID,
		Width: media.Width, Height: media.Height,
		MimeType:           media.MimeType,
		URL:                "/media/" + media.ID,
		Size:               media.Size,
		Deduped:            deduped,
		AltText:            media.AltText,
		OriginalFilename:   media.OriginalFilename,
		Source:             defaultMediaSource(media.Source),
		AssetKind:          defaultMediaAssetKind(media.AssetKind),
		RetentionClass:     defaultMediaRetentionClass(media.RetentionClass),
		ParentMediaID:      media.ParentMediaID,
		DesignDocumentID:   media.DesignDocumentID,
		DesignPageID:       media.DesignPageID,
		ProcessingStatus:   media.ProcessingStatus,
		ProcessingProgress: media.ProcessingProgress,
		AnalysisStatus:     media.AnalysisStatus,
		AnalysisError:      media.AnalysisError,
		PosterThumbnailURL: mediaPosterURL(media),
	}
}

func mediaUploadMap(media models.MediaAttachment, deduped bool) map[string]interface{} {
	result := mediaUploadResultFromAttachment(media, deduped)
	return map[string]interface{}{
		"id":                   result.ID,
		"mime_type":            result.MimeType,
		"url":                  result.URL,
		"size":                 result.Size,
		"deduped":              result.Deduped,
		"alt_text":             result.AltText,
		"original_filename":    result.OriginalFilename,
		"source":               result.Source,
		"asset_kind":           result.AssetKind,
		"retention_class":      result.RetentionClass,
		"parent_media_id":      result.ParentMediaID,
		"design_document_id":   result.DesignDocumentID,
		"design_page_id":       result.DesignPageID,
		"processing_status":    result.ProcessingStatus,
		"processing_progress":  result.ProcessingProgress,
		"analysis_status":      result.AnalysisStatus,
		"analysis_error":       result.AnalysisError,
		"poster_thumbnail_url": result.PosterThumbnailURL,
	}
}

func isInternalMediaAssetKind(assetKind string) bool {
	switch defaultMediaAssetKind(assetKind) {
	case "design_preview", "template_preview":
		return true
	default:
		return false
	}
}

func defaultMediaRetentionClass(value string) string {
	if strings.TrimSpace(value) == medialifecycle.RetentionTemporary {
		return medialifecycle.RetentionTemporary
	}
	return medialifecycle.RetentionLibrary
}

func mediaSourceSupportsDeduplication(source string) bool {
	switch source {
	case "upload", "video_editor_source", "stock_import":
		return true
	default:
		return false
	}
}

func normalizeMediaProvenance(source, assetKind string) (string, string, error) {
	source = defaultMediaSource(source)
	switch source {
	case "upload", "media_copy", "image_optimization", "image_fit", "camera", "image_editor_export", "image_editor_edit", "background_removal", "image_generation",
		"video_editor_source", "video_editor_export", "stock_import", "meme_generator", "screenshot_template":
	default:
		return "", "", errors.New("invalid media source")
	}
	assetKind = defaultMediaAssetKind(assetKind)
	switch assetKind {
	case "library", "brand_asset", "brand_font", "design_preview", "template_preview", "project_asset":
	default:
		return "", "", errors.New("invalid media asset kind")
	}
	if assetKind == "design_preview" && source != "image_editor_export" && source != "image_editor_edit" {
		return "", "", errors.New("design previews must be produced by OpenPost Image Editor")
	}
	if assetKind == "project_asset" && source != "upload" && source != "camera" && source != "video_editor_source" {
		return "", "", errors.New("project Assets must come from an upload, camera, or Video Editor source")
	}
	return source, assetKind, nil
}

func parseStockMediaProvenance(raw string) (*StockMediaProvenance, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var provenance StockMediaProvenance
	if err := json.Unmarshal([]byte(raw), &provenance); err != nil {
		return nil, errors.New("stock provenance must be valid JSON")
	}
	if err := ValidateStockMediaProvenance(provenance); err != nil {
		return nil, err
	}
	return &provenance, nil
}

func validateStockUploadProvenance(source string, provenance *StockMediaProvenance) error {
	if source == "stock_import" && provenance == nil {
		return errors.New("stock imports require license and creator provenance")
	}
	if provenance == nil {
		return nil
	}
	if source != "stock_import" {
		return errors.New("stock provenance is allowed only for stock imports")
	}
	return ValidateStockMediaProvenance(*provenance)
}

func (h *MediaHandler) persistStockMediaProvenance(
	ctx context.Context,
	mediaID string,
	provenance *StockMediaProvenance,
) error {
	return h.persistStockMediaProvenanceWithDB(ctx, h.db, mediaID, provenance)
}

func (h *MediaHandler) persistStockMediaProvenanceWithDB(
	ctx context.Context,
	db bun.IDB,
	mediaID string,
	provenance *StockMediaProvenance,
) error {
	if provenance == nil {
		return nil
	}
	record := &models.MediaProvenance{
		MediaID:         mediaID,
		Provider:        strings.TrimSpace(provenance.Provider),
		ExternalID:      strings.TrimSpace(provenance.ExternalID),
		SourceURL:       strings.TrimSpace(provenance.SourceURL),
		CreatorName:     strings.TrimSpace(provenance.CreatorName),
		CreatorURL:      strings.TrimSpace(provenance.CreatorURL),
		LicenseName:     strings.TrimSpace(provenance.LicenseName),
		LicenseURL:      strings.TrimSpace(provenance.LicenseURL),
		AttributionText: strings.TrimSpace(provenance.AttributionText),
		ImportedAt:      time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(record).On("CONFLICT (media_id) DO NOTHING").Exec(ctx)
	return err
}

func (h *MediaHandler) reusableMediaForClientHash(
	ctx context.Context,
	workspaceID string,
	clientSHA256 string,
	size int64,
	mimeType string,
	assetKind string,
) (*models.MediaAttachment, error) {
	hash := strings.ToLower(strings.TrimSpace(clientSHA256))
	if hash == "" {
		return nil, nil
	}
	if len(hash) != sha256.Size*2 {
		return nil, huma.Error400BadRequest("client_sha256 must be a SHA-256 hex digest")
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return nil, huma.Error400BadRequest("client_sha256 must be a SHA-256 hex digest")
	}
	var media models.MediaAttachment
	query := h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND file_hash = ? AND size = ? AND mime_type = ? AND processing_status = ?", workspaceID, hash, size, mimeType, mediaReadyStatus)
	if assetKind == "project_asset" {
		query = query.Where("asset_kind NOT IN (?, ?)", "design_preview", "template_preview")
	} else {
		query = query.Where("asset_kind = ?", "library")
	}
	err := query.
		OrderExpr("created_at ASC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to check reusable workspace media")
	}
	if strings.HasPrefix(media.MimeType, "image/") {
		// A legacy row without dimensions cannot feed aspect-ratio embeds.
		// Decline early reuse so upload completion repairs it before reuse.
		if media.Width <= 0 || media.Height <= 0 {
			return nil, nil
		}
		stored, openErr := h.storage.Open(ctx, filepath.Base(media.FilePath))
		if openErr != nil {
			return nil, nil
		}
		content, readErr := io.ReadAll(io.LimitReader(stored, MaxBufferedMediaUploadBytes+1))
		_ = stored.Close()
		if readErr != nil || int64(len(content)) > MaxBufferedMediaUploadBytes || validateMediaImageContent(media.MimeType, content) != nil {
			return nil, nil
		}
	}
	return &media, nil
}

func defaultMediaSource(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "upload"
}

func defaultMediaAssetKind(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "library"
}

func (h *MediaHandler) validateMediaProvenanceReferences(ctx context.Context, workspaceID, parentMediaID, designDocumentID, designPageID string) error {
	parentMediaID = strings.TrimSpace(parentMediaID)
	designDocumentID = strings.TrimSpace(designDocumentID)
	designPageID = strings.TrimSpace(designPageID)
	if parentMediaID != "" {
		count, err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
			Where("id = ? AND workspace_id = ?", parentMediaID, workspaceID).
			Count(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to validate source media")
		}
		if count != 1 {
			return huma.Error400BadRequest("source media must belong to the workspace")
		}
	}
	if designDocumentID == "" && designPageID != "" {
		return huma.Error400BadRequest("design_document_id is required with design_page_id")
	}
	if designDocumentID != "" {
		count, err := h.db.NewSelect().Model((*models.DesignDocument)(nil)).
			Where("id = ? AND workspace_id = ? AND deleted_at IS NULL", designDocumentID, workspaceID).
			Count(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to validate OpenPost Image Editor design")
		}
		if count != 1 {
			return huma.Error400BadRequest("OpenPost Image Editor design must belong to the workspace")
		}
	}
	if designPageID != "" {
		count, err := h.db.NewSelect().Model((*models.DesignPage)(nil)).
			Where("id = ? AND design_document_id = ?", designPageID, designDocumentID).
			Count(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to validate OpenPost Image Editor page")
		}
		if count != 1 {
			return huma.Error400BadRequest("OpenPost Image Editor page must belong to the design")
		}
	}
	return nil
}

func normalizeMediaFilename(current, requested string) (string, error) {
	name := strings.TrimSpace(requested)
	if name == "" {
		return "", errors.New("filename is required")
	}
	if len([]rune(name)) > 255 {
		return "", errors.New("filename must be 255 characters or fewer")
	}
	if strings.ContainsAny(name, `/\\`) || strings.IndexFunc(name, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return "", errors.New("filename cannot contain path separators or control characters")
	}
	currentExtension := filepath.Ext(strings.TrimSpace(current))
	requestedExtension := filepath.Ext(name)
	if currentExtension != "" && requestedExtension == "" {
		return name + currentExtension, nil
	}
	if currentExtension != "" && !strings.EqualFold(currentExtension, requestedExtension) {
		return "", errors.New("file extension cannot be changed")
	}
	return name, nil
}
