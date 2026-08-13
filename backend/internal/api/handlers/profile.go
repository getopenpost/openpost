package handlers

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
)

const maxAvatarBytes = 4 * 1024 * 1024

type ProfileHandler struct {
	db      *bun.DB
	auth    middleware.Authenticator
	storage mediastore.BlobStorage
}

func NewProfileHandler(db *bun.DB, authenticator middleware.Authenticator, storage mediastore.BlobStorage) *ProfileHandler {
	return &ProfileHandler{db: db, auth: authenticator, storage: storage}
}

func (h *ProfileHandler) RegisterLegacyRoutes(e *echo.Echo) {
	auth := middleware.BearerMiddleware(h.auth)
	e.POST("/api/v1/auth/profile/avatar", h.uploadAvatar, auth)
	e.GET("/avatars/:id", h.serveAvatar)
	e.HEAD("/avatars/:id", h.serveAvatar)
}

type RemoveAvatarOutput struct {
	Body struct {
		Removed bool `json:"removed" doc:"Whether the profile avatar was removed"`
	}
}

func (h *ProfileHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-profile-avatar",
		Method:      http.MethodDelete,
		Path:        "/auth/profile/avatar",
		Summary:     "Remove current user profile avatar",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{401, 404, 500},
	}, func(ctx context.Context, _ *struct{}) (*RemoveAvatarOutput, error) {
		if err := h.deleteAvatarForUser(ctx, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		out := &RemoveAvatarOutput{}
		out.Body.Removed = true
		return out, nil
	})
}

func (h *ProfileHandler) uploadAvatar(c echo.Context) error {
	if h.storage == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "avatar storage is not configured"})
	}
	userID := c.Get(string(middleware.UserIDKey)).(string)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "file is required"})
	}
	if fileHeader.Size > maxAvatarBytes {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "avatar must be 4MB or smaller"})
	}
	file, err := fileHeader.Open()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to open avatar file"})
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxAvatarBytes+1))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to read avatar file"})
	}
	if len(content) == 0 || len(content) > maxAvatarBytes {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "avatar must be 4MB or smaller"})
	}
	contentType := http.DetectContentType(content)
	ext := avatarExtension(contentType)
	if ext == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "avatar must be a PNG, JPEG, GIF, or WebP image"})
	}

	var user models.User
	if err := h.db.NewSelect().Model(&user).Where("id = ?", userID).Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "user not found"})
	}

	objectKey := "avatar_" + userID + "_" + uuid.New().String() + ext
	if _, err := mediastore.SaveWithContentType(h.storage, objectKey, bytes.NewReader(content), contentType); err != nil {
		log.Printf("failed to save profile avatar for user %s: %v", userID, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to save avatar"})
	}
	avatarURL := "/avatars/" + objectKey
	if _, err := h.db.NewUpdate().
		Model((*models.User)(nil)).
		Set("avatar_url = ?", avatarURL).
		Set("avatar_object_key = ?", objectKey).
		Where("id = ?", userID).
		Exec(c.Request().Context()); err != nil {
		_ = h.storage.Delete(objectKey)
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to update profile avatar"})
	}
	if strings.TrimSpace(user.AvatarObjectKey) != "" && user.AvatarObjectKey != objectKey {
		_ = h.storage.Delete(filepath.Base(user.AvatarObjectKey))
	}

	return c.JSON(http.StatusOK, map[string]string{"avatar_url": avatarURL})
}

func (h *ProfileHandler) deleteAvatarForUser(ctx context.Context, userID string) error {
	var user models.User
	if err := h.db.NewSelect().Model(&user).Where("id = ?", userID).Scan(ctx); err != nil {
		return huma.Error404NotFound("user not found")
	}
	if _, err := h.db.NewUpdate().
		Model((*models.User)(nil)).
		Set("avatar_url = ?", "").
		Set("avatar_object_key = ?", "").
		Where("id = ?", userID).
		Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to remove profile avatar")
	}
	if h.storage != nil && strings.TrimSpace(user.AvatarObjectKey) != "" {
		_ = h.storage.Delete(filepath.Base(user.AvatarObjectKey))
	}
	return nil
}

func (h *ProfileHandler) serveAvatar(c echo.Context) error {
	if h.storage == nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "avatar not found"})
	}
	objectKey := filepath.Base(strings.TrimSpace(c.Param("id")))
	if objectKey == "." || objectKey == "" || !strings.HasPrefix(objectKey, "avatar_") {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "avatar not found"})
	}
	file, err := h.storage.Open(objectKey)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "avatar not found"})
	}
	defer file.Close()
	contentType := avatarContentType(filepath.Ext(objectKey))
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().Header().Set("Cache-Control", "public, max-age=604800, immutable")
	if c.Request().Method == http.MethodHead {
		return c.NoContent(http.StatusOK)
	}
	return c.Stream(http.StatusOK, contentType, file)
}

func avatarExtension(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

func avatarContentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}
