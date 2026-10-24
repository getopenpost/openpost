package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/instancebackup"
	"github.com/stretchr/testify/require"
)

type instanceBackupTestServer struct {
	echo     *echo.Echo
	restarts *atomic.Int32
	paths    instancebackup.Paths
}

func newInstanceBackupTestServer(t *testing.T, isAdmin bool, authenticator middleware.Authenticator, mutate func(*InstanceBackupConfig)) *instanceBackupTestServer {
	t.Helper()
	db := createHandlerTestDB(t, (*models.User)(nil), (*migrations.SchemaMigration)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", IsAdmin: isAdmin, CreatedAt: time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)
	latest, err := migrations.LatestVersion()
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&migrations.SchemaMigration{Version: latest, AppliedAt: time.Now().Unix()}).Exec(context.Background())
	require.NoError(t, err)

	root := t.TempDir()
	paths := instancebackup.Paths{DatabaseFile: filepath.Join(root, "db", "openpost.db"), MediaDir: filepath.Join(root, "media")}
	require.NoError(t, os.MkdirAll(filepath.Dir(paths.DatabaseFile), 0o755))
	require.NoError(t, os.MkdirAll(paths.MediaDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(paths.MediaDir, "photo.png"), []byte("photo"), 0o644))

	restarts := &atomic.Int32{}
	config := InstanceBackupConfig{
		Paths:          paths,
		AppVersion:     "test",
		DatabaseDriver: "sqlite",
		StorageDriver:  "local",
		EncryptionKey:  strings.Repeat("k", 32),
		ProcessRole:    "all",
		Restart:        func() { restarts.Add(1) },
	}
	if mutate != nil {
		mutate(&config)
	}
	handler := NewInstanceBackupHandler(db, authenticator, config)
	handler.restartDelay = time.Millisecond
	e := echo.New()
	handler.RegisterRoutes(e)
	return &instanceBackupTestServer{echo: e, restarts: restarts, paths: paths}
}

func (s *instanceBackupTestServer) do(t *testing.T, method, path string, body []byte, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer web-token")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestInstanceBackupRequiresBrowserSessionAdmin(t *testing.T) {
	t.Run("non-admin session", func(t *testing.T) {
		server := newInstanceBackupTestServer(t, false, browserSessionTestAuthenticator(), nil)
		for _, path := range []string{"/api/v1/admin/backup", "/api/v1/admin/backup/export"} {
			response := server.do(t, http.MethodGet, path, nil, "")
			require.Equal(t, http.StatusForbidden, response.Code, path+": "+response.Body.String())
		}
		response := server.do(t, http.MethodPost, "/api/v1/admin/backup/restore/upload", []byte("x"), "application/zip")
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	})

	t.Run("API token", func(t *testing.T) {
		server := newInstanceBackupTestServer(t, true, unboundCLIFullTestAuthenticator(), nil)
		response := server.do(t, http.MethodGet, "/api/v1/admin/backup/export", nil, "")
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	})
}

func TestInstanceBackupReportsUnsupportedSetups(t *testing.T) {
	server := newInstanceBackupTestServer(t, true, browserSessionTestAuthenticator(), func(config *InstanceBackupConfig) {
		config.StorageDriver = "s3"
	})

	status := server.do(t, http.MethodGet, "/api/v1/admin/backup", nil, "")
	require.Equal(t, http.StatusOK, status.Code, status.Body.String())
	var body instanceBackupStatus
	require.NoError(t, json.Unmarshal(status.Body.Bytes(), &body))
	require.False(t, body.Supported)
	require.Equal(t, "storage", body.UnsupportedReason)

	export := server.do(t, http.MethodGet, "/api/v1/admin/backup/export", nil, "")
	require.Equal(t, http.StatusConflict, export.Code, export.Body.String())
}

func TestInstanceBackupExportAndStagedRestore(t *testing.T) {
	server := newInstanceBackupTestServer(t, true, browserSessionTestAuthenticator(), nil)

	export := server.do(t, http.MethodGet, "/api/v1/admin/backup/export", nil, "")
	require.Equal(t, http.StatusOK, export.Code, export.Body.String())
	require.Equal(t, "application/zip", export.Header().Get("Content-Type"))
	require.Contains(t, export.Header().Get("Content-Disposition"), "openpost-backup-")
	archive, err := zip.NewReader(bytes.NewReader(export.Body.Bytes()), int64(export.Body.Len()))
	require.NoError(t, err)
	names := make([]string, 0, len(archive.File))
	for _, file := range archive.File {
		names = append(names, file.Name)
	}
	require.ElementsMatch(t, []string{"database/openpost.db", "media/photo.png", "manifest.json"}, names)

	upload := server.do(t, http.MethodPost, "/api/v1/admin/backup/restore/upload", export.Body.Bytes(), "application/zip")
	require.Equal(t, http.StatusOK, upload.Code, upload.Body.String())
	var summary instanceBackupSummary
	require.NoError(t, json.Unmarshal(upload.Body.Bytes(), &summary))
	require.Equal(t, 1, summary.MediaFiles)

	status := server.do(t, http.MethodGet, "/api/v1/admin/backup", nil, "")
	var body instanceBackupStatus
	require.NoError(t, json.Unmarshal(status.Body.Bytes(), &body))
	require.True(t, body.Supported)
	require.NotNil(t, body.Pending)

	rejected := server.do(t, http.MethodPost, "/api/v1/admin/backup/restore/confirm", []byte(`{"confirm":"yes"}`), "application/json")
	require.Equal(t, http.StatusBadRequest, rejected.Code, rejected.Body.String())
	require.Zero(t, server.restarts.Load())

	confirmed := server.do(t, http.MethodPost, "/api/v1/admin/backup/restore/confirm", []byte(`{"confirm":"restore"}`), "application/json")
	require.Equal(t, http.StatusAccepted, confirmed.Code, confirmed.Body.String())
	require.Eventually(t, func() bool { return server.restarts.Load() == 1 }, time.Second, 5*time.Millisecond)
}

func TestInstanceBackupRejectsInvalidUploadAndCancelsStagedRestore(t *testing.T) {
	server := newInstanceBackupTestServer(t, true, browserSessionTestAuthenticator(), nil)

	invalid := server.do(t, http.MethodPost, "/api/v1/admin/backup/restore/upload", []byte("not a backup"), "application/zip")
	require.Equal(t, http.StatusBadRequest, invalid.Code, invalid.Body.String())
	require.Contains(t, invalid.Body.String(), "invalid_backup")

	nothing := server.do(t, http.MethodPost, "/api/v1/admin/backup/restore/confirm", []byte(`{"confirm":"restore"}`), "application/json")
	require.Equal(t, http.StatusConflict, nothing.Code, nothing.Body.String())

	export := server.do(t, http.MethodGet, "/api/v1/admin/backup/export", nil, "")
	require.Equal(t, http.StatusOK, export.Code)
	require.Equal(t, http.StatusOK, server.do(t, http.MethodPost, "/api/v1/admin/backup/restore/upload", export.Body.Bytes(), "application/zip").Code)

	cancelled := server.do(t, http.MethodDelete, "/api/v1/admin/backup/restore/pending", nil, "")
	require.Equal(t, http.StatusNoContent, cancelled.Code, cancelled.Body.String())
	pending, err := instancebackup.ReadPending(server.paths)
	require.NoError(t, err)
	require.Nil(t, pending)
}
