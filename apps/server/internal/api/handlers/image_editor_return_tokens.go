package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

func (h *ImageEditorHandler) createReturnToken(ctx context.Context, input *CreateImageEditorReturnTokenInput) (*CreateImageEditorReturnTokenOutput, error) {
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
	returnURL, err := normalizeImageEditorReturnURL(input.Body.ReturnURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	maxSelection := input.Body.MaxSelection
	if maxSelection <= 0 {
		maxSelection = 1
	}
	constraints, err := json.Marshal(input.Body.Constraints)
	if err != nil || len(constraints) > 32<<10 {
		return nil, huma.Error400BadRequest("OpenPost Image Editor return constraints are invalid")
	}
	rawToken, tokenHash, err := newImageEditorReturnToken()
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor return token")
	}
	now := time.Now().UTC()
	record := &models.DesignReturnToken{
		ID:              uuid.NewString(),
		TokenHash:       tokenHash,
		WorkspaceID:     workspaceID,
		UserID:          middleware.GetUserID(ctx),
		ReturnURL:       returnURL,
		Purpose:         strings.TrimSpace(input.Body.Purpose),
		MaxSelection:    maxSelection,
		ConstraintsJSON: string(constraints),
		ResultMediaIDs:  "[]",
		CreatedAt:       now,
		ExpiresAt:       now.Add(2 * time.Hour),
	}
	if record.Purpose == "" {
		record.Purpose = "post_media"
	}
	if _, err := h.db.NewInsert().Model(record).Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to store OpenPost Image Editor return token")
	}
	out := &CreateImageEditorReturnTokenOutput{}
	out.Body.Token = rawToken
	out.Body.ExpiresAt = record.ExpiresAt.Format(time.RFC3339)
	return out, nil
}

//nolint:gocyclo // Return completion validates the token and every ordered export constraint together.
func (h *ImageEditorHandler) completeReturnToken(ctx context.Context, input *CompleteImageEditorReturnTokenInput) (*CompleteImageEditorReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if !record.CompletedAt.IsZero() || !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been used")
	}
	mediaIDs := uniqueImageEditorStringsInOrder(input.Body.MediaIDs)
	if len(mediaIDs) == 0 || len(mediaIDs) > record.MaxSelection {
		return nil, huma.Error400BadRequest("OpenPost Image Editor export count does not match the return constraints")
	}
	var media []models.MediaAttachment
	err = h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND processing_status = ? AND id IN (?)", record.WorkspaceID, mediaReadyStatus, bun.List(mediaIDs)).
		Scan(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to validate OpenPost Image Editor exports")
	}
	if len(media) != len(mediaIDs) {
		return nil, huma.Error400BadRequest("every OpenPost Image Editor export must belong to the workspace")
	}
	var constraints struct {
		AllowedMIMEs []string `json:"allowed_mimes"`
		MaxWidth     int      `json:"max_width"`
		MaxHeight    int      `json:"max_height"`
		MaxFileSize  int64    `json:"max_file_size"`
	}
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &constraints); err != nil {
		return nil, huma.Error400BadRequest("OpenPost Image Editor return constraints are invalid")
	}
	allowedMIMEs := make(map[string]struct{}, len(constraints.AllowedMIMEs))
	for _, mime := range constraints.AllowedMIMEs {
		allowedMIMEs[strings.ToLower(strings.TrimSpace(mime))] = struct{}{}
	}
	for _, item := range media {
		if len(allowedMIMEs) > 0 {
			if _, ok := allowedMIMEs[strings.ToLower(item.MimeType)]; !ok {
				return nil, huma.Error400BadRequest("an OpenPost Image Editor export format is not supported by the composer")
			}
		}
		if constraints.MaxWidth > 0 && item.Width > constraints.MaxWidth {
			return nil, huma.Error400BadRequest("an OpenPost Image Editor export is wider than the composer allows")
		}
		if constraints.MaxHeight > 0 && item.Height > constraints.MaxHeight {
			return nil, huma.Error400BadRequest("an OpenPost Image Editor export is taller than the composer allows")
		}
		if constraints.MaxFileSize > 0 && item.Size > constraints.MaxFileSize {
			return nil, huma.Error400BadRequest("an OpenPost Image Editor export is larger than the composer allows")
		}
		if input.Body.DesignID != "" && item.DesignDocumentID != input.Body.DesignID {
			return nil, huma.Error400BadRequest("every OpenPost Image Editor export must come from the returning design")
		}
	}
	if input.Body.DesignID != "" {
		count, err := h.db.NewSelect().Model((*models.DesignDocument)(nil)).
			Where("id = ? AND workspace_id = ? AND deleted_at IS NULL", input.Body.DesignID, record.WorkspaceID).
			Count(ctx)
		if err != nil || count != 1 {
			return nil, huma.Error400BadRequest("OpenPost Image Editor design must belong to the workspace")
		}
	}
	encodedIDs, _ := json.Marshal(mediaIDs)
	now := time.Now().UTC()
	result, err := h.db.NewUpdate().Model((*models.DesignReturnToken)(nil)).
		Set("result_media_ids = ?", string(encodedIDs)).
		Set("design_id = ?", strings.TrimSpace(input.Body.DesignID)).
		Set("completed_at = ?", now).
		Where("id = ? AND completed_at IS NULL AND consumed_at IS NULL", record.ID).
		Exec(ctx)
	if err != nil {
		log.Printf("failed to complete OpenPost Image Editor return token %s: %v", record.ID, err)
		return nil, huma.Error500InternalServerError("failed to complete OpenPost Image Editor return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been used")
	}
	out := &CompleteImageEditorReturnTokenOutput{}
	out.Body.ReturnURL = record.ReturnURL
	return out, nil
}

func (h *ImageEditorHandler) consumeReturnToken(ctx context.Context, input *ConsumeImageEditorReturnTokenInput) (*ConsumeImageEditorReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if record.CompletedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token is not complete")
	}
	if !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been consumed")
	}
	now := time.Now().UTC()
	result, err := h.db.NewUpdate().Model((*models.DesignReturnToken)(nil)).
		Set("consumed_at = ?", now).
		Where("id = ? AND consumed_at IS NULL", record.ID).
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to consume OpenPost Image Editor return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been consumed")
	}
	out := &ConsumeImageEditorReturnTokenOutput{}
	out.Body.WorkspaceID = record.WorkspaceID
	out.Body.ReturnURL = record.ReturnURL
	out.Body.Purpose = record.Purpose
	out.Body.DesignID = record.DesignID
	if err := json.Unmarshal([]byte(record.ResultMediaIDs), &out.Body.MediaIDs); err != nil {
		return nil, huma.Error500InternalServerError("OpenPost Image Editor return token result is corrupt")
	}
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &out.Body.Constraints); err != nil {
		out.Body.Constraints = map[string]any{}
	}
	return out, nil
}

func (h *ImageEditorHandler) loadReturnToken(ctx context.Context, rawToken string) (*models.DesignReturnToken, error) {
	if strings.TrimSpace(rawToken) == "" {
		return nil, huma.Error400BadRequest("OpenPost Image Editor return token is required")
	}
	hash := sha256.Sum256([]byte(rawToken))
	var record models.DesignReturnToken
	err := h.db.NewSelect().Model(&record).
		Where("token_hash = ? AND user_id = ?", hex.EncodeToString(hash[:]), middleware.GetUserID(ctx)).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Image Editor return token not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor return token")
	}
	if time.Now().UTC().After(record.ExpiresAt) {
		return nil, huma.Error404NotFound("OpenPost Image Editor return token has expired")
	}
	if _, err := h.requireAccess(ctx, record.WorkspaceID, true); err != nil {
		return nil, err
	}
	return &record, nil
}

func newImageEditorReturnToken() (string, string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(bytes[:])
	hash := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(hash[:]), nil
}

func normalizeImageEditorReturnURL(raw string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") || strings.HasPrefix(parsed.Path, "//") {
		return "", errors.New("image editor return URL must be a same-origin OpenPost route")
	}
	path := parsed.Path
	allowed := path == "/" ||
		path == "/media" ||
		strings.HasPrefix(path, "/publications/")
	if !allowed {
		return "", errors.New("image editor return URL is not an allowed composer route")
	}
	return parsed.String(), nil
}

func uniqueImageEditorStringsInOrder(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}
