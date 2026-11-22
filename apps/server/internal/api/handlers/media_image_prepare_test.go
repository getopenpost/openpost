package handlers

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

func TestOptimizeImageRetainsOriginalAndReusesCopy(t *testing.T) {
	t.Parallel()
	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	var content bytes.Buffer
	require.NoError(t, (&png.Encoder{CompressionLevel: png.NoCompression}).Encode(&content, image.NewNRGBA(image.Rect(0, 0, 128, 128))))
	var original models.MediaAttachment
	_, err := srv.handler.processUploadBytes(t.Context(), mediaUploadBytesInput{WorkspaceID: "ws-1", Filename: "original.png", Content: content.Bytes(), AltText: "Original caption", Source: "upload", OnCreated: func(m models.MediaAttachment) { original = m }})
	require.NoError(t, err)
	var copyID string
	for range 2 {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/"+original.ID+"/optimize-image", nil)
		req.Header.Set("Authorization", "Bearer web-token")
		response := httptest.NewRecorder()
		srv.echo.ServeHTTP(response, req)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var output OptimizeMediaImageOutput
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
		require.True(t, output.Body.Optimized)
		require.NotEqual(t, original.ID, output.Body.Media.ID)
		require.Equal(t, original.ID, output.Body.Media.ParentMediaID)
		require.Equal(t, "image_optimization", output.Body.Media.Source)
		require.Equal(t, "Original caption", output.Body.Media.AltText)
		require.Less(t, output.Body.Media.Size, original.Size)
		if copyID != "" {
			require.Equal(t, copyID, output.Body.Media.ID)
		}
		copyID = output.Body.Media.ID
	}
	file, err := storage.Open(t.Context(), filepath.Base(original.FilePath))
	require.NoError(t, err)
	saved, err := io.ReadAll(file)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	require.Equal(t, content.Bytes(), saved)
	_, err = srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/"+original.ID+"/optimize-image", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	denied := httptest.NewRecorder()
	srv.echo.ServeHTTP(denied, req)
	require.Equal(t, http.StatusForbidden, denied.Code)
}
