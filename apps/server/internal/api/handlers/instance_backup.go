package handlers

import (
	"errors"
	"io/fs"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	echoMiddleware "github.com/labstack/echo/v4/middleware"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/services/instancebackup"
	"github.com/uptrace/bun"
)

const (
	instanceBackupMaxUploadBytes = 64 << 30
	instanceBackupRestartDelay   = time.Second
	instanceBackupConfirmWord    = "restore"
)

type InstanceBackupConfig struct {
	Paths          instancebackup.Paths
	AppVersion     string
	DatabaseDriver string
	StorageDriver  string
	EncryptionKey  string
	ProcessRole    string
	Restart        func()
}

type InstanceBackupHandler struct {
	db     *bun.DB
	authn  middleware.Authenticator
	config InstanceBackupConfig
	busy   sync.Mutex
	now    func() time.Time

	restartDelay time.Duration
}

type instanceBackupSummary struct {
	CreatedAt     time.Time `json:"created_at"`
	AppVersion    string    `json:"app_version"`
	DatabaseBytes int64     `json:"database_bytes"`
	MediaFiles    int       `json:"media_files"`
	MediaBytes    int64     `json:"media_bytes"`
	SchemaVersion int64     `json:"schema_version"`
	StagedAt      time.Time `json:"staged_at,omitzero"`
}

type instanceRestorePoint struct {
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	Bytes     int64     `json:"bytes"`
}

type instanceBackupStatus struct {
	Supported         bool                   `json:"supported"`
	UnsupportedReason string                 `json:"unsupported_reason,omitempty"`
	Pending           *instanceBackupSummary `json:"pending,omitempty"`
	RestorePoints     []instanceRestorePoint `json:"restore_points"`
}

func NewInstanceBackupHandler(db *bun.DB, authenticator middleware.Authenticator, config InstanceBackupConfig) *InstanceBackupHandler {
	return &InstanceBackupHandler{db: db, authn: authenticator, config: config, now: time.Now, restartDelay: instanceBackupRestartDelay}
}

func (h *InstanceBackupHandler) RegisterRoutes(e *echo.Echo) {
	auth := middleware.BearerMiddleware(h.authn)
	e.GET("/api/v1/admin/backup", h.status, auth)
	e.GET("/api/v1/admin/backup/export", h.export, auth)
	e.POST("/api/v1/admin/backup/restore/upload", h.upload, echoMiddleware.BodyLimit("64G"), auth)
	e.POST("/api/v1/admin/backup/restore/confirm", h.confirm, auth)
	e.DELETE("/api/v1/admin/backup/restore/pending", h.cancel, auth)
	e.DELETE("/api/v1/admin/backup/restore-points/:name", h.deleteRestorePoint, auth)
}

func (h *InstanceBackupHandler) unsupportedReason() string {
	switch {
	case h.config.DatabaseDriver != "sqlite" || h.config.Paths.DatabaseFile == "":
		return "database"
	case h.config.StorageDriver != "local":
		return "storage"
	case h.config.ProcessRole != "all":
		return "process_role"
	}
	return ""
}

func (h *InstanceBackupHandler) authorize(c echo.Context) error {
	if err := requireBrowserSessionInstanceAdmin(c.Request().Context(), h.db); err != nil {
		var statusErr huma.StatusError
		if errors.As(err, &statusErr) {
			return c.JSON(statusErr.GetStatus(), map[string]string{fieldError: statusErr.Error()})
		}
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: "instance admin role required"})
	}
	if reason := h.unsupportedReason(); reason != "" {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "backup is not available for this setup", "code": "unsupported_" + reason})
	}
	return nil
}

func (h *InstanceBackupHandler) current() (instancebackup.Current, error) {
	latest, err := migrations.LatestVersion()
	if err != nil {
		return instancebackup.Current{}, err
	}
	return instancebackup.Current{
		DatabaseDriver:           h.config.DatabaseDriver,
		StorageDriver:            h.config.StorageDriver,
		SchemaVersion:            latest,
		EncryptionKeyFingerprint: instancebackup.KeyFingerprint(h.config.EncryptionKey),
	}, nil
}

func (h *InstanceBackupHandler) status(c echo.Context) error {
	if err := requireBrowserSessionInstanceAdmin(c.Request().Context(), h.db); err != nil {
		var statusErr huma.StatusError
		if errors.As(err, &statusErr) {
			return c.JSON(statusErr.GetStatus(), map[string]string{fieldError: statusErr.Error()})
		}
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: "instance admin role required"})
	}
	response := instanceBackupStatus{RestorePoints: []instanceRestorePoint{}}
	if reason := h.unsupportedReason(); reason != "" {
		response.UnsupportedReason = reason
		return c.JSON(http.StatusOK, response)
	}
	response.Supported = true
	pending, err := instancebackup.ReadPending(h.config.Paths)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to read the staged restore"})
	}
	if pending != nil {
		summary := summarizeBackup(pending.Manifest)
		summary.StagedAt = pending.StagedAt
		response.Pending = &summary
	}
	points, err := instancebackup.ListRestorePoints(h.config.Paths)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to list restore points"})
	}
	for _, point := range points {
		response.RestorePoints = append(response.RestorePoints, instanceRestorePoint{Name: point.Name, CreatedAt: point.CreatedAt, Bytes: point.Bytes})
	}
	return c.JSON(http.StatusOK, response)
}

func (h *InstanceBackupHandler) export(c echo.Context) error {
	if err := h.authorize(c); err != nil || c.Response().Committed {
		return err
	}
	if !h.busy.TryLock() {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "another backup operation is in progress", "code": "busy"})
	}
	defer h.busy.Unlock()

	filename := "openpost-backup-" + h.now().UTC().Format("20060102-150405") + ".zip"
	response := c.Response()
	response.Header().Set(echo.HeaderContentType, "application/zip")
	response.Header().Set(echo.HeaderContentDisposition, `attachment; filename="`+filename+`"`)
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)

	_, err := instancebackup.WriteArchive(c.Request().Context(), h.db, instancebackup.ExportOptions{
		AppVersion:               h.config.AppVersion,
		DatabaseDriver:           h.config.DatabaseDriver,
		StorageDriver:            h.config.StorageDriver,
		EncryptionKeyFingerprint: instancebackup.KeyFingerprint(h.config.EncryptionKey),
		Paths:                    h.config.Paths,
		Now:                      h.now,
	}, response)
	if err != nil {
		c.Logger().Errorf("instance backup export failed: %v", err)
		panic(http.ErrAbortHandler)
	}
	return nil
}

func (h *InstanceBackupHandler) upload(c echo.Context) error {
	if err := h.authorize(c); err != nil || c.Response().Committed {
		return err
	}
	if !h.busy.TryLock() {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "another backup operation is in progress", "code": "busy"})
	}
	defer h.busy.Unlock()

	current, err := h.current()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to read the schema version"})
	}
	body := http.MaxBytesReader(c.Response(), c.Request().Body, instanceBackupMaxUploadBytes)
	manifest, err := instancebackup.Stage(c.Request().Context(), h.config.Paths, current, body, h.now())
	if err != nil {
		return h.stageFailure(c, err)
	}
	summary := summarizeBackup(manifest)
	summary.StagedAt = h.now().UTC()
	return c.JSON(http.StatusOK, summary)
}

func (h *InstanceBackupHandler) stageFailure(c echo.Context, err error) error {
	switch {
	case errors.Is(err, instancebackup.ErrInvalidArchive):
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: err.Error(), "code": "invalid_backup"})
	case errors.Is(err, instancebackup.ErrUnsupportedBackup):
		return c.JSON(http.StatusUnprocessableEntity, map[string]string{fieldError: err.Error(), "code": "incompatible_backup"})
	case errors.Is(err, instancebackup.ErrBackupTooNew):
		return c.JSON(http.StatusUnprocessableEntity, map[string]string{fieldError: err.Error(), "code": "backup_too_new"})
	case errors.Is(err, instancebackup.ErrKeyMismatch):
		return c.JSON(http.StatusUnprocessableEntity, map[string]string{fieldError: err.Error(), "code": "key_mismatch"})
	}
	c.Logger().Errorf("instance backup staging failed: %v", err)
	return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to prepare the backup for restore", "code": "stage_failed"})
}

func (h *InstanceBackupHandler) confirm(c echo.Context) error {
	if err := h.authorize(c); err != nil || c.Response().Committed {
		return err
	}
	var body struct {
		Confirm string `json:"confirm"`
	}
	if err := c.Bind(&body); err != nil || body.Confirm != instanceBackupConfirmWord {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "confirmation text does not match", "code": "confirmation_required"})
	}
	if !h.busy.TryLock() {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "another backup operation is in progress", "code": "busy"})
	}
	defer h.busy.Unlock()

	pending, err := instancebackup.ReadPending(h.config.Paths)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to read the staged restore"})
	}
	if pending == nil {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "no backup is staged for restore", "code": "nothing_staged"})
	}
	if h.config.Restart == nil {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "this server cannot restart itself", "code": "restart_unavailable"})
	}
	restart := h.config.Restart
	time.AfterFunc(h.restartDelay, restart)
	return c.JSON(http.StatusAccepted, map[string]bool{"restarting": true})
}

func (h *InstanceBackupHandler) cancel(c echo.Context) error {
	if err := h.authorize(c); err != nil || c.Response().Committed {
		return err
	}
	if !h.busy.TryLock() {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "another backup operation is in progress", "code": "busy"})
	}
	defer h.busy.Unlock()
	if err := instancebackup.CancelPending(h.config.Paths); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to discard the staged restore"})
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *InstanceBackupHandler) deleteRestorePoint(c echo.Context) error {
	if err := h.authorize(c); err != nil || c.Response().Committed {
		return err
	}
	err := instancebackup.DeleteRestorePoint(h.config.Paths, c.Param("name"))
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "restore point not found"})
	case err != nil:
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to delete the restore point"})
	}
	return c.NoContent(http.StatusNoContent)
}

func summarizeBackup(manifest instancebackup.Manifest) instanceBackupSummary {
	return instanceBackupSummary{
		CreatedAt:     manifest.CreatedAt,
		AppVersion:    manifest.AppVersion,
		DatabaseBytes: manifest.DatabaseBytes,
		MediaFiles:    manifest.MediaFiles,
		MediaBytes:    manifest.MediaBytes,
		SchemaVersion: manifest.SchemaVersion,
	}
}
