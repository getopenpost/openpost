package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/uptrace/bun"
)

type mcpMedia struct {
	ID                 string  `json:"id"`
	WorkspaceID        string  `json:"workspace_id,omitempty"`
	MimeType           string  `json:"mime_type"`
	URL                string  `json:"url"`
	ThumbnailURL       string  `json:"thumbnail_url,omitempty"`
	Size               int64   `json:"size"`
	Deduped            bool    `json:"deduped"`
	Filename           string  `json:"filename"`
	OriginalFilename   string  `json:"original_filename,omitempty"`
	AltText            string  `json:"alt_text,omitempty"`
	SourceURL          string  `json:"source_url,omitempty"`
	Width              int     `json:"width,omitempty"`
	Height             int     `json:"height,omitempty"`
	DurationMS         int64   `json:"duration_ms,omitempty"`
	FrameRate          float64 `json:"frame_rate,omitempty"`
	AspectRatio        string  `json:"aspect_ratio,omitempty"`
	DominantType       string  `json:"dominant_type,omitempty"`
	AnalysisStatus     string  `json:"analysis_status,omitempty"`
	AnalysisError      string  `json:"analysis_error,omitempty"`
	PublicURLReady     bool    `json:"public_url_ready,omitempty"`
	PublicURLCheckedAt string  `json:"public_url_checked_at,omitempty"`
	PublicURLStatus    int     `json:"public_url_status,omitempty"`
	PublicURLError     string  `json:"public_url_error,omitempty"`
	IsFavorite         bool    `json:"is_favorite,omitempty"`
	CreatedAt          string  `json:"created_at,omitempty"`
	ProcessingStatus   string  `json:"processing_status,omitempty"`
	UsageCount         int     `json:"usage_count,omitempty"`
	CanDelete          bool    `json:"can_delete"`
}

type mcpListMediaInput struct {
	WorkspaceID string `json:"workspace_id"`
	Limit       int    `json:"limit"`
	Filter      string `json:"filter"`
	Cursor      string `json:"cursor"`
}

//nolint:gocyclo // Cursor, filter, count, and usage checks each preserve a distinct API error.
func (h *MCPHandler) listMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpListMediaInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_media arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	limit := input.Limit
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 100 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 100"}
	}
	var cursor *timestampIDCursor
	if strings.TrimSpace(input.Cursor) != "" {
		parsed, err := parseTimestampIDCursor(input.Cursor)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "invalid list_media cursor; repeat the previous response's next_cursor unchanged"}
		}
		cursor = &parsed
	}

	filter := strings.TrimSpace(input.Filter)
	applyMediaFilter := func(query *bun.SelectQuery) (*bun.SelectQuery, *mcpError) {
		switch filter {
		case "", "all":
		case "favorites":
			query = query.Where("workspace_id = ? AND is_favorite = ?", input.WorkspaceID, true)
		case "used":
			query = query.Where("workspace_id = ? AND id IN (SELECT media_id FROM post_media)", input.WorkspaceID)
		case "unused":
			query = query.Where("workspace_id = ? AND id NOT IN (SELECT media_id FROM post_media)", input.WorkspaceID)
		default:
			return nil, &mcpError{Code: -32602, Message: "filter must be one of all, favorites, used, or unused"}
		}
		if filter == "" || filter == "all" {
			query = query.Where("workspace_id = ?", input.WorkspaceID)
		}
		return query, nil
	}

	countQuery := h.db.NewSelect().Model((*models.MediaAttachment)(nil))
	countQuery, rpcErr := applyMediaFilter(countQuery)
	if rpcErr != nil {
		return nil, rpcErr
	}
	total, err := countQuery.Count(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list media"}
	}

	var rows []models.MediaAttachment
	query := h.db.NewSelect().Model(&rows)
	query, rpcErr = applyMediaFilter(query)
	if rpcErr != nil {
		return nil, rpcErr
	}
	query = query.Order("created_at DESC", "id DESC")
	if cursor != nil {
		query = query.Where(
			"(created_at < ? OR (created_at = ? AND id < ?))",
			cursor.Timestamp, cursor.Timestamp, cursor.ID,
		)
	}
	err = query.Limit(int64(limit+1)).Scan(ctx, &rows)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list media"}
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	mediaHandler := &MediaHandler{db: h.db}
	media := make([]mcpMedia, 0, len(rows))
	for _, row := range rows {
		usage, err := mediaHandler.mediaUsageSummary(ctx, row.WorkspaceID, row.ID)
		if err != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to check media usage"}
		}
		media = append(media, mcpMediaFromAttachment(row, usage.Total, usage.Blocking == 0))
	}
	nextCursor := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		nextCursor = encodeTimestampIDCursor(last.CreatedAt, last.ID)
	}

	text := fmt.Sprintf("Found %d of %d media items.", len(media), total)
	if len(media) == 0 {
		text = "No media attachments found."
	} else if hasMore {
		text = fmt.Sprintf("Found %d of %d media items; more are available. Repeat the request with cursor %q while has_more is true.", len(media), total, nextCursor)
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"media":       media,
			"has_more":    hasMore,
			"next_cursor": nextCursor,
			"total_count": total,
		},
	}, nil
}

func (h *MCPHandler) callMediaTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	switch normalizeMCPOperationName(toolName) {
	case mcpToolGetMedia:
		return h.getMedia(ctx, userID, args)
	case mcpToolUpdateMedia:
		return h.updateMedia(ctx, userID, args)
	case mcpToolPrepareImage:
		return h.prepareMediaImage(ctx, userID, args)
	case mcpToolDeleteMedia:
		return h.deleteMedia(ctx, userID, args)
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

func (h *MCPHandler) loadMCPMedia(ctx context.Context, userID, mediaID string) (models.MediaAttachment, *mcpError) {
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Where("id = ?", strings.TrimSpace(mediaID)).Scan(ctx); err != nil {
		return media, &mcpError{Code: -32602, Message: "media not found or unavailable"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, media.WorkspaceID); rpcErr != nil {
		return media, rpcErr
	}
	return media, nil
}

func (h *MCPHandler) mcpMediaResult(ctx context.Context, media models.MediaAttachment, message string) (any, *mcpError) {
	mediaHandler := &MediaHandler{db: h.db}
	usage, err := mediaHandler.mediaUsageSummary(ctx, media.WorkspaceID, media.ID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to check media usage"}
	}
	out := mcpMediaFromAttachment(media, usage.Total, usage.Blocking == 0)
	text := message
	if text == "" {
		text = "Media loaded: " + media.ID
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{"media": out},
	}, nil
}

func (h *MCPHandler) getMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		MediaID string `json:"media_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.MediaID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid get_media arguments"}
	}
	media, rpcErr := h.loadMCPMedia(ctx, userID, input.MediaID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpMediaResult(ctx, media, "")
}

//nolint:gocyclo // Favorite and alt-text updates share one replay boundary and preserve their API errors.
func (h *MCPHandler) updateMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		MediaID        string  `json:"media_id"`
		Favorite       *bool   `json:"favorite"`
		AltText        *string `json:"alt_text"`
		IdempotencyKey string  `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.MediaID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid update_media arguments"}
	}
	if input.Favorite == nil && input.AltText == nil {
		return nil, &mcpError{Code: -32602, Message: "favorite or alt_text is required"}
	}
	media, rpcErr := h.loadMCPMedia(ctx, userID, input.MediaID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, media.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	apply := func() (models.MediaAttachment, *mcpError) {
		updated := media
		if input.Favorite != nil && updated.IsFavorite != *input.Favorite {
			handler := &MediaHandler{db: h.db}
			// The favorite toggle endpoint flips state; loop until it holds
			// the requested value (at most two transitions).
			for i := 0; i < 2; i++ {
				out, err := handler.updateMediaFavorite(ctx, &UpdateMediaFavoriteInput{PathID: updated.ID})
				if err != nil {
					return updated, &mcpError{Code: -32603, Message: "failed to update media"}
				}
				updated.IsFavorite = out.Body.IsFavorite
				if updated.IsFavorite == *input.Favorite {
					break
				}
			}
			if updated.IsFavorite != *input.Favorite {
				return updated, &mcpError{Code: -32603, Message: "failed to update media"}
			}
		}
		if input.AltText != nil {
			altText := strings.TrimSpace(*input.AltText)
			handler := &MediaHandler{db: h.db}
			var updateInput UpdateMediaInput
			updateInput.PathID = updated.ID
			updateInput.Body.AltText = &altText
			if _, err := handler.updateMedia(ctx, &updateInput); err != nil {
				return updated, &mcpError{Code: -32602, Message: err.Error()}
			}
			updated.AltText = altText
		}
		if err := h.db.NewSelect().Model(&updated).Where("id = ?", updated.ID).Scan(ctx); err != nil {
			return updated, &mcpError{Code: -32603, Message: "failed to load updated media"}
		}
		return updated, nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, media.WorkspaceID, "update-media", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = media.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				MediaID  string  `json:"media_id"`
				Favorite *bool   `json:"favorite"`
				AltText  *string `json:"alt_text"`
			}{media.ID, input.Favorite, input.AltText})
			if replay, found, err := idempotency.Replay[mcpMedia](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to update media")
				}
				return map[string]any{
					"content":           []mcpContent{{Type: "text", Text: "Media updated: " + media.ID}},
					"structuredContent": map[string]any{"media": replay.Value},
				}, nil
			}
			updated, rpcErr := apply()
			if rpcErr != nil {
				return nil, rpcErr
			}
			mediaHandler := &MediaHandler{db: h.db}
			usage, err := mediaHandler.mediaUsageSummary(ctx, updated.WorkspaceID, updated.ID)
			if err != nil {
				return nil, &mcpError{Code: -32603, Message: "failed to check media usage"}
			}
			out := mcpMediaFromAttachment(updated, usage.Total, usage.Blocking == 0)
			if stored, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (mcpMedia, error) {
				_ = txCtx
				_ = tx
				return out, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to update media")
				}
				return nil, &mcpError{Code: -32603, Message: "media updated but the replay record failed"}
			} else if stored.Replayed {
				out = stored.Value
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: "Media updated: " + updated.ID}},
				"structuredContent": map[string]any{"media": out},
			}, nil
		}
	}
	updated, rpcErr := apply()
	if rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpMediaResult(ctx, updated, "Media updated: "+updated.ID)
}

//nolint:gocyclo // Authorization, confirmation, provider errors, and replay have distinct outcomes.
func (h *MCPHandler) deleteMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		MediaID        string `json:"media_id"`
		Confirm        bool   `json:"confirm"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.MediaID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid delete_media arguments"}
	}
	media, rpcErr := h.loadMCPMedia(ctx, userID, input.MediaID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	// Authorization precedes the irreversible-action gate so viewers always
	// see the workspace role error first.
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, media.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := mcpRequireConfirm(args, "delete_media"); rpcErr != nil {
		return nil, rpcErr
	}
	remove := func() *mcpError {
		handler := &MediaHandler{db: h.db}
		_, err := handler.deleteMedia(ctx, &DeleteMediaInput{PathID: media.ID})
		if err != nil {
			var statusErr huma.StatusError
			if errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError {
				return &mcpError{Code: -32602, Message: err.Error()}
			}
			return &mcpError{Code: -32603, Message: "failed to delete media"}
		}
		return nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, media.WorkspaceID, "delete-media", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = media.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				MediaID string `json:"media_id"`
			}{media.ID})
			var opErr *mcpError
			result, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (string, error) {
				_ = tx
				_ = txCtx
				if rpcErr := remove(); rpcErr != nil {
					opErr = rpcErr
					return "", errors.New(rpcErr.Message)
				}
				return media.ID, nil
			})
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to delete media")
				}
				if opErr != nil {
					return nil, opErr
				}
				return nil, &mcpError{Code: -32603, Message: "failed to delete media"}
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: "Media deleted: " + result.Value}},
				"structuredContent": map[string]any{"message": "Media deleted: " + result.Value, "media_id": result.Value},
			}, nil
		}
	}
	if rpcErr := remove(); rpcErr != nil {
		return nil, rpcErr
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Media deleted: " + media.ID}},
		"structuredContent": map[string]any{"message": "Media deleted: " + media.ID, "media_id": media.ID},
	}, nil
}

func mcpMediaFromAttachment(media models.MediaAttachment, usageCount int, canDelete bool) mcpMedia {
	thumbnailURL := "/media/" + media.ID + "/thumb"
	if mcpHasSmallThumbnail(media.ThumbnailsJSON) {
		thumbnailURL = "/media/" + media.ID + "/thumb/sm"
	}
	out := mcpMedia{
		ID:               media.ID,
		WorkspaceID:      media.WorkspaceID,
		MimeType:         media.MimeType,
		URL:              "/media/" + media.ID,
		ThumbnailURL:     thumbnailURL,
		Size:             media.Size,
		Filename:         media.OriginalFilename,
		OriginalFilename: media.OriginalFilename,
		AltText:          media.AltText,
		Width:            media.Width,
		Height:           media.Height,
		DurationMS:       media.DurationMS,
		FrameRate:        media.FrameRate,
		AspectRatio:      media.AspectRatio,
		DominantType:     media.DominantType,
		AnalysisStatus:   media.AnalysisStatus,
		AnalysisError:    media.AnalysisError,
		PublicURLReady:   media.PublicURLReady,
		PublicURLStatus:  media.PublicURLStatus,
		PublicURLError:   media.PublicURLError,
		IsFavorite:       media.IsFavorite,
		CreatedAt:        media.CreatedAt.Format(time.RFC3339),
		ProcessingStatus: media.ProcessingStatus,
		UsageCount:       usageCount,
		CanDelete:        canDelete,
	}
	if !media.PublicURLCheckedAt.IsZero() {
		out.PublicURLCheckedAt = media.PublicURLCheckedAt.UTC().Format(time.RFC3339)
	}
	return out
}

func mcpHasSmallThumbnail(raw string) bool {
	if strings.TrimSpace(raw) == "" {
		return false
	}
	var thumbnails Thumbnails
	if err := json.Unmarshal([]byte(raw), &thumbnails); err != nil {
		return false
	}
	return thumbnails.SM != ""
}

func (h *MCPHandler) uploadMediaFromURL(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID    string `json:"workspace_id"`
		URL            string `json:"url"`
		Filename       string `json:"filename"`
		AltText        string `json:"alt_text"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid upload_media_from_url arguments"}
	}
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if h.mediaStorage == nil {
		return nil, &mcpError{Code: -32603, Message: "media storage is not configured"}
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, strings.TrimSpace(input.WorkspaceID), "upload-media-from-url", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.RequestHash, _ = idempotency.Hash(struct {
				WorkspaceID string `json:"workspace_id"`
				URL         string `json:"url"`
				Filename    string `json:"filename"`
				AltText     string `json:"alt_text"`
			}{strings.TrimSpace(input.WorkspaceID), strings.TrimSpace(input.URL), strings.TrimSpace(input.Filename), strings.TrimSpace(input.AltText)})
			if replay, found, err := idempotency.Replay[mcpMedia](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to upload media")
				}
				return map[string]any{
					"content":           []mcpContent{{Type: "text", Text: "Media uploaded: " + replay.Value.ID}},
					"structuredContent": map[string]any{"media": replay.Value},
				}, nil
			}
			media, rpcErr := h.fetchAndStoreRemoteMedia(ctx, input.WorkspaceID, input.URL, input.Filename, input.AltText)
			if rpcErr != nil {
				return nil, rpcErr
			}
			request.ResourceID = media.ID
			if result, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (mcpMedia, error) {
				_ = txCtx
				_ = tx
				return media, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to upload media")
				}
				return nil, &mcpError{Code: -32603, Message: "media uploaded but the replay record failed"}
			} else if result.Replayed {
				media = result.Value
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: "Media uploaded: " + media.ID}},
				"structuredContent": map[string]any{"media": media},
			}, nil
		}
	}

	media, rpcErr := h.fetchAndStoreRemoteMedia(ctx, input.WorkspaceID, input.URL, input.Filename, input.AltText)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: "Media uploaded: " + media.ID,
		}},
		"structuredContent": map[string]any{
			"media": media,
		},
	}, nil
}

func (h *MCPHandler) fetchAndStoreRemoteMedia(ctx context.Context, workspaceID, rawURL, filename, altText string) (mcpMedia, *mcpError) {
	remote, filename, declaredMimeType, content, rpcErr := h.fetchRemoteMedia(ctx, rawURL, filename)
	if rpcErr != nil {
		return mcpMedia{}, rpcErr
	}
	media, rpcErr := h.storeMCPMediaBytes(ctx, mediaUploadBytesInput{
		WorkspaceID: workspaceID, Filename: filename, DeclaredMimeType: declaredMimeType,
		Size: int64(len(content)), Content: content, AltText: altText,
	})
	media.SourceURL = remote.String()
	return media, rpcErr
}

func (h *MCPHandler) renderLocalMediaUpload(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid render_local_media_upload arguments"}
	}
	// The picker itself changes no state, matching its read-only annotation;
	// the one-use upload ticket is the state-changing step.
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Local media upload is ready."}},
		"structuredContent": map[string]any{"workspace_id": input.WorkspaceID},
	}, nil
}

//nolint:gocyclo // Ticket validation, minting, and replay must keep their failure modes distinct.
func (h *MCPHandler) createLocalMediaUploadTicket(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID    string `json:"workspace_id"`
		Filename       string `json:"filename"`
		MimeType       string `json:"mime_type"`
		Size           int64  `json:"size"`
		AltText        string `json:"alt_text"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid create_local_media_upload_ticket arguments"}
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	filename := cleanUploadFilename(input.Filename)
	if filename == "" {
		return nil, &mcpError{Code: -32602, Message: "filename is required"}
	}
	if input.Size <= 0 {
		return nil, &mcpError{Code: -32602, Message: "file size is invalid"}
	}
	sizeLimit := mediaUploadSizeLimit("library", filename, input.MimeType)
	if input.Size > sizeLimit {
		return nil, &mcpError{Code: -32602, Message: mediaUploadSizeError(sizeLimit)}
	}
	token := uuid.NewString()
	expiresAt := time.Now().UTC().Add(mcpMediaUploadTTL)
	mint := func() (map[string]any, *mcpError) {
		ticket := &models.MCPMediaUploadTicket{
			ID: uuid.NewString(), TicketHash: hashMCPMediaUploadTicket(token),
			WorkspaceID: input.WorkspaceID, UserID: userID,
			SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx), ClientID: middleware.GetClientID(ctx),
			Filename: filename, MimeType: strings.TrimSpace(input.MimeType), Size: input.Size,
			AltText: strings.TrimSpace(input.AltText), ExpiresAt: expiresAt,
		}
		if _, err := h.db.NewInsert().Model(ticket).Exec(ctx); err != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to prepare media upload"}
		}
		uploadURL := strings.TrimRight(h.publicURL, "/") + "/mcp/media-upload"
		if strings.TrimSpace(h.publicURL) == "" {
			uploadURL = "/mcp/media-upload"
		}
		return map[string]any{
			"content":           []mcpContent{{Type: "text", Text: "Secure local media upload prepared."}},
			"structuredContent": map[string]any{"ready": true, "expires_at": expiresAt.Format(time.RFC3339)},
			"_meta": map[string]any{"upload": map[string]any{
				"url": uploadURL, "method": http.MethodPut,
				"headers":    map[string]string{"Authorization": "Upload " + token, "Content-Type": ticket.MimeType},
				"expires_at": expiresAt.Format(time.RFC3339),
			}},
		}, nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, strings.TrimSpace(input.WorkspaceID), "create-local-media-upload-ticket", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.RequestHash, _ = idempotency.Hash(struct {
				WorkspaceID string `json:"workspace_id"`
				Filename    string `json:"filename"`
				MimeType    string `json:"mime_type"`
				Size        int64  `json:"size"`
				AltText     string `json:"alt_text"`
			}{strings.TrimSpace(input.WorkspaceID), filename, strings.TrimSpace(input.MimeType), input.Size, strings.TrimSpace(input.AltText)})
			if replay, found, err := idempotency.Replay[map[string]any](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to prepare media upload")
				}
				return replay.Value, nil
			}
			result, rpcErr := mint()
			if rpcErr != nil {
				return nil, rpcErr
			}
			if stored, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (map[string]any, error) {
				_ = txCtx
				_ = tx
				return result, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to prepare media upload")
				}
				// The ticket is minted; only the replay record failed.
				return nil, &mcpError{Code: -32603, Message: "upload prepared but the replay record failed"}
			} else if stored.Replayed {
				return stored.Value, nil
			}
			return result, nil
		}
	}
	return mint()
}

func hashMCPMediaUploadTicket(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func (h *MCPHandler) handleLocalMediaUpload(c echo.Context) error {
	if h.mediaHandler == nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{fieldError: "media upload is not configured"})
	}
	rawToken, ok := strings.CutPrefix(c.Request().Header.Get(echo.HeaderAuthorization), "Upload ")
	if !ok || strings.TrimSpace(rawToken) == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: "missing upload ticket"})
	}
	now := time.Now().UTC()
	var ticket models.MCPMediaUploadTicket
	err := h.db.NewUpdate().Model(&ticket).
		Set("consumed_at = ?", now).
		Where("ticket_hash = ?", hashMCPMediaUploadTicket(strings.TrimSpace(rawToken))).
		Where("consumed_at IS NULL").
		Where("expires_at > ?", now).
		Returning("*").
		Scan(c.Request().Context())
	if errors.Is(err, sql.ErrNoRows) {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: "upload ticket is invalid, expired, or already used"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to validate upload ticket"})
	}
	principal, err := h.localUploadTicketPrincipal(c.Request().Context(), ticket, now)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: err.Error()})
	}

	uploadCtx := contextWithMCPPrincipal(c.Request().Context(), principal)
	if err := h.ensureWorkspaceEditAccess(uploadCtx, ticket.UserID, ticket.WorkspaceID); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: "upload workspace is no longer accessible"})
	}

	if c.Request().ContentLength >= 0 && c.Request().ContentLength != ticket.Size {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "uploaded media size does not match declared size"})
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, ticket.Size+1)
	result, uploadErr := h.mediaHandler.processUploadStream(
		uploadCtx, ticket.WorkspaceID, ticket.Filename, ticket.MimeType, ticket.Size, c.Request().Body,
		mediaUploadBytesInput{AltText: ticket.AltText},
	)
	if uploadErr != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: uploadErr.Error()})
	}
	return c.JSON(http.StatusCreated, result)
}

func (h *MCPHandler) fetchRemoteMedia(ctx context.Context, rawURL, requestedFilename string) (*url.URL, string, string, []byte, *mcpError) {
	remote, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || remote == nil || remote.Host == "" {
		return nil, "", "", nil, &mcpError{Code: -32602, Message: "url must be an absolute http(s) URL"}
	}
	if rpcErr := h.validateMediaURL(ctx, remote); rpcErr != nil {
		return nil, "", "", nil, rpcErr
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remote.String(), nil)
	if err != nil {
		return nil, "", "", nil, &mcpError{Code: -32602, Message: "invalid url"}
	}
	req.Header.Set("User-Agent", "openpost-mcp-media/"+h.serverVersion)
	resp, err := h.remoteMediaHTTPClient().Do(req)
	if err != nil {
		return nil, "", "", nil, &mcpError{Code: -32602, Message: "failed to fetch media url"}
	}
	defer func() { _ = resp.Body.Close() }()
	finalURL, content, rpcErr := h.readRemoteMediaResponse(ctx, resp)
	if rpcErr != nil {
		return nil, "", "", nil, rpcErr
	}

	filename := remoteMediaFilename(requestedFilename, finalURL)
	return finalURL, filename, resp.Header.Get("Content-Type"), content, nil
}

func (h *MCPHandler) readRemoteMediaResponse(ctx context.Context, resp *http.Response) (*url.URL, []byte, *mcpError) {
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, &mcpError{Code: -32602, Message: fmt.Sprintf("media url returned HTTP %d", resp.StatusCode)}
	}
	finalURL := resp.Request.URL
	if rpcErr := h.validateMediaURL(ctx, finalURL); rpcErr != nil {
		return nil, nil, rpcErr
	}
	content, err := io.ReadAll(io.LimitReader(resp.Body, maxRemoteMediaBytes+1))
	if err != nil {
		return nil, nil, &mcpError{Code: -32603, Message: "failed to read remote media"}
	}
	if len(content) == 0 {
		return nil, nil, &mcpError{Code: -32602, Message: "remote media is empty"}
	}
	if len(content) > maxRemoteMediaBytes {
		return nil, nil, &mcpError{Code: -32602, Message: "file size exceeds 50MB limit"}
	}
	return finalURL, content, nil
}

func remoteMediaFilename(requestedFilename string, finalURL *url.URL) string {
	filename := cleanRemoteMediaFilename(requestedFilename)
	if filename == "" {
		filename = cleanRemoteMediaFilename(path.Base(finalURL.Path))
	}
	if filename == "" || filename == "." || filename == "/" {
		filename = "remote-media"
	}
	return filename
}

func (h *MCPHandler) remoteMediaHTTPClient() *http.Client {
	if h.mediaURLHTTP != nil {
		return h.mediaURLHTTP
	}
	client := netguard.NewHTTPClient(30*time.Second, mediaURLPolicy())
	client.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		validator := h.mediaURLValidator
		if validator == nil {
			validator = h.defaultValidateMediaURL
		}
		return validator(req.Context(), req.URL)
	}
	return client
}

func (h *MCPHandler) validateMediaURL(ctx context.Context, remote *url.URL) *mcpError {
	validator := h.mediaURLValidator
	if validator == nil {
		validator = h.defaultValidateMediaURL
	}
	if err := validator(ctx, remote); err != nil {
		return &mcpError{Code: -32602, Message: err.Error()}
	}
	return nil
}

func (h *MCPHandler) defaultValidateMediaURL(ctx context.Context, remote *url.URL) error {
	return netguard.ValidateURL(ctx, remote, mediaURLPolicy())
}

func mediaURLPolicy() netguard.URLPolicy {
	return netguard.URLPolicy{
		Label:            "url",
		AllowedSchemes:   []string{"http", "https"},
		AllowCustomPorts: true,
	}
}

func cleanRemoteMediaFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	filename = strings.Trim(filename, `/\`)
	if filename == "" || filename == "." {
		return ""
	}
	filename = path.Base(filename)
	filename = strings.ReplaceAll(filename, "\x00", "")
	return filename
}

func (h *MCPHandler) localUploadTicketPrincipal(ctx context.Context, ticket models.MCPMediaUploadTicket, now time.Time) (*middleware.Principal, error) {
	principal := &middleware.Principal{UserID: ticket.UserID, SessionID: ticket.SessionID, TokenID: ticket.TokenID, ClientID: ticket.ClientID, WorkspaceID: ticket.WorkspaceID}
	switch {
	case ticket.SessionID != "":
		if _, err := sessions.NewService(h.db).ValidateSession(ctx, ticket.UserID, ticket.SessionID); err != nil {
			return nil, errors.New("upload session is no longer active")
		}
	case ticket.TokenID != "":
		var token models.APIToken
		err := h.db.NewSelect().Model(&token).Where("id = ? AND user_id = ? AND revoked_at IS NULL", ticket.TokenID, ticket.UserID).Where("expires_at IS NULL OR expires_at > ?", now).Scan(ctx)
		if err != nil || !mcpScopeAllowed(token.Scope) || mcpScopeIsReadOnly(token.Scope) || (token.WorkspaceID != "" && token.WorkspaceID != ticket.WorkspaceID) {
			return nil, errors.New("upload credential is no longer active")
		}
		principal.Scope = token.Scope
	default:
		return nil, errors.New("upload credential is unavailable")
	}
	return principal, nil
}
