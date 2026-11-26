package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
)

func (h *MediaHandler) serveMedia(c echo.Context) error {
	mediaID := c.Param("id")

	// Strip file extension if present (e.g., "abc123.jpg" -> "abc123")
	// Media IDs in the database are UUIDs without extensions, but Threads
	// requires URLs with extensions for content-type detection.
	if dotIdx := strings.LastIndex(mediaID, "."); dotIdx > 0 {
		mediaID = mediaID[:dotIdx]
	}

	media := new(models.MediaAttachment)
	if err := h.db.NewSelect().Model(media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}
	if err := h.authorizeMediaAccess(c, media); err != nil {
		return err
	}
	if !media.TrashedAt.IsZero() {
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media was deleted"})
	}

	file, err := h.storage.Open(c.Request().Context(), filepath.Base(media.FilePath))
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "media file not found"})
	}
	defer file.Close()

	contentType := setMediaResponseHeaders(c.Response().Header(), media.MimeType, media.OriginalFilename)
	if f, ok := file.(*os.File); ok {
		if stat, err := f.Stat(); err == nil {
			http.ServeContent(c.Response(), c.Request(), stat.Name(), stat.ModTime(), f)
			return nil
		}
	}

	return c.Stream(http.StatusOK, contentType, file)
}

func (h *MediaHandler) serveThumbnailSize(c echo.Context) error {
	mediaID := c.Param("id")

	// Strip file extension if present (e.g., "abc123.jpg" -> "abc123")
	if dotIdx := strings.LastIndex(mediaID, "."); dotIdx > 0 {
		mediaID = mediaID[:dotIdx]
	}

	size := c.Param("size")
	if size == "" {
		size = "md"
	}

	media := new(models.MediaAttachment)
	if err := h.db.NewSelect().Model(media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}
	if err := h.authorizeMediaAccess(c, media); err != nil {
		return err
	}
	if !media.TrashedAt.IsZero() {
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media was deleted"})
	}

	var thumbs Thumbnails
	if media.ThumbnailsJSON != "" {
		_ = json.Unmarshal([]byte(media.ThumbnailsJSON), &thumbs)
	}

	var thumbFilename string
	switch size {
	case "sm":
		thumbFilename = thumbs.SM
	case "md":
		thumbFilename = thumbs.MD
	default:
		thumbFilename = thumbs.MD
	}

	if thumbFilename == "" {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "thumbnail not found"})
	}

	file, err := h.storage.Open(c.Request().Context(), thumbFilename)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "thumbnail file not found"})
	}
	defer file.Close()

	if f, ok := file.(*os.File); ok {
		if stat, err := f.Stat(); err == nil {
			c.Response().Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
		}
	}

	contentType := thumbnailContentType(thumbFilename)
	setMediaResponseHeaders(c.Response().Header(), contentType, "")
	return c.Stream(http.StatusOK, contentType, file)
}

func (h *MediaHandler) serveVideoPoster(c echo.Context) error {
	mediaID := c.Param("id")
	if dotIdx := strings.LastIndex(mediaID, "."); dotIdx > 0 {
		mediaID = mediaID[:dotIdx]
	}
	media := new(models.MediaAttachment)
	if err := h.db.NewSelect().Model(media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}
	if err := h.authorizeMediaAccess(c, media); err != nil {
		return err
	}
	if !media.TrashedAt.IsZero() {
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media was deleted"})
	}
	if strings.TrimSpace(media.ThumbnailObjectKey) == "" {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "video poster not found"})
	}
	file, err := h.storage.Open(c.Request().Context(), media.ThumbnailObjectKey)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "video poster file not found"})
	}
	defer file.Close()
	setMediaResponseHeaders(c.Response().Header(), "image/jpeg", "")
	if f, ok := file.(*os.File); ok {
		if stat, statErr := f.Stat(); statErr == nil {
			http.ServeContent(c.Response(), c.Request(), stat.Name(), stat.ModTime(), f)
			return nil
		}
	}
	return c.Stream(http.StatusOK, "image/jpeg", file)
}

func (h *MediaHandler) optionalMediaAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			_, cookieErr := c.Cookie("openpost_session")
			if (authHeader != "" || cookieErr == nil) && h.authn != nil {
				return middleware.BearerMiddleware(h.authn)(next)(c)
			}
			if authHeader != "" && h.auth != nil {
				return middleware.JWTMiddleware(h.auth)(next)(c)
			}
			return next(c)
		}
	}
}

func (h *MediaHandler) authorizeMediaAccess(c echo.Context, media *models.MediaAttachment) error {
	if media == nil {
		return echo.NewHTTPError(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}

	if userID, _ := c.Get(string(middleware.UserIDKey)).(string); userID != "" {
		allowed, err := h.userCanAccessWorkspace(c.Request().Context(), media.WorkspaceID, userID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
		}
		if !allowed {
			return echo.NewHTTPError(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
		}
		setCredentialMediaCache(c)
		return nil
	}

	if token := c.QueryParam("token"); token != "" {
		principal, err := h.principalFromQueryToken(c.Request().Context(), token)
		if errors.Is(err, errMediaQueryTokenScope) {
			return echo.NewHTTPError(http.StatusForbidden, map[string]string{fieldError: "token is not authorized for media access"})
		}
		if err == nil && principal != nil {
			middleware.AttachPrincipal(c, principal)
			allowed, accessErr := h.userCanAccessWorkspace(c.Request().Context(), media.WorkspaceID, principal.UserID)
			if accessErr != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
			}
			if allowed {
				setCredentialMediaCache(c)
				return nil
			}
			return echo.NewHTTPError(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
		}
	}

	expiresAtUnix, _ := strconv.ParseInt(c.QueryParam("exp"), 10, 64)
	signature := c.QueryParam("sig")
	if signature == "" || h.signer == nil || !h.signer.Verify(media.ID, signature, expiresAtUnix) {
		return echo.NewHTTPError(http.StatusUnauthorized, map[string]string{fieldError: "authentication required"})
	}

	remainingSeconds := expiresAtUnix - time.Now().UTC().Unix()
	if remainingSeconds < 0 {
		remainingSeconds = 0
	}
	c.Response().Header().Set("Cache-Control", "public, max-age="+strconv.FormatInt(remainingSeconds, 10))
	return nil
}

var errMediaQueryTokenScope = errors.New("query token scope cannot access media")

func (h *MediaHandler) principalFromQueryToken(ctx context.Context, token string) (*middleware.Principal, error) {
	if h.authn != nil {
		principal, err := h.authn.AuthenticateBearer(ctx, token)
		if err != nil || principal == nil {
			return nil, err
		}
		if !middleware.PrincipalCanAccessREST(principal) {
			return nil, errMediaQueryTokenScope
		}
		return principal, nil
	}
	if h.auth != nil {
		claims, err := h.auth.ValidateToken(token)
		if err == nil && claims != nil {
			return &middleware.Principal{
				UserID: claims.UserID, Email: claims.Email, SessionID: claims.SessionID,
			}, nil
		}
		return nil, err
	}
	return nil, errors.New("media authentication is unavailable")
}

func setCredentialMediaCache(c echo.Context) {
	header := c.Response().Header()
	header.Set("Cache-Control", "private, max-age=86400")
	appendVaryHeaders(header, echo.HeaderAuthorization, echo.HeaderCookie)
}

func appendVaryHeaders(header http.Header, fields ...string) {
	existingValues := header.Values(echo.HeaderVary)
	capacity := len(existingValues) + len(fields)
	values := make([]string, 0, capacity)
	seen := make(map[string]struct{}, capacity)
	appendValue := func(value string) bool {
		value = strings.TrimSpace(value)
		if value == "" {
			return false
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			return false
		}
		seen[key] = struct{}{}
		values = append(values, value)
		return value == "*"
	}

	for _, existing := range existingValues {
		for _, value := range strings.Split(existing, ",") {
			if appendValue(value) {
				header.Set(echo.HeaderVary, "*")
				return
			}
		}
	}
	for _, field := range fields {
		if appendValue(field) {
			header.Set(echo.HeaderVary, "*")
			return
		}
	}
	if len(values) > 0 {
		header.Set(echo.HeaderVary, strings.Join(values, ", "))
	}
}
