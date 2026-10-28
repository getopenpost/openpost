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

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

func TestPrepareImageUsesDestinationAndPreservesOriginalAcrossRESTAndMCP(t *testing.T) {
	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	_, err := srv.db.NewCreateTable().Model((*models.SocialAccount)(nil)).Exec(t.Context())
	require.NoError(t, err)
	srv.handler.SetCapabilityResolver(NewCapabilityResolverHandler(srv.db, nil, map[string]platform.Adapter{"bluesky": xCapabilityResolverAdapter{result: platform.AccountCapabilityResult{Constraints: map[string]any{"max_image_pixels": int64(2048), "allowed_mimes": []string{"image/jpeg"}}}}}, capabilityResolverTokenSource{}))
	account := &models.SocialAccount{ID: "destination", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "remote", Slug: "destination", AccessTokenEnc: []byte("test"), IsActive: true}
	_, err = srv.db.NewInsert().Model(account).Exec(t.Context())
	require.NoError(t, err)
	// A real active account in another Workspace proves the ownership check, not
	// merely that an unknown account ID is missing.
	_, err = srv.db.NewInsert().Model(&models.Workspace{ID: "ws-2", Name: "Other"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.SocialAccount{ID: "other-workspace", WorkspaceID: "ws-2", Platform: "bluesky", AccountID: "remote-other", Slug: "other-workspace", AccessTokenEnc: []byte("test"), IsActive: true}).Exec(t.Context())
	require.NoError(t, err)
	var content bytes.Buffer
	require.NoError(t, png.Encode(&content, image.NewNRGBA(image.Rect(0, 0, 128, 64))))
	var original models.MediaAttachment
	_, err = srv.handler.processUploadBytes(t.Context(), mediaUploadBytesInput{WorkspaceID: "ws-1", Filename: "original.png", Content: content.Bytes(), Source: "upload", AltText: "Source description", OnCreated: func(m models.MediaAttachment) { original = m }})
	require.NoError(t, err)
	var derivativeID string
	prepare := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/"+original.ID+"/prepare-image", bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		srv.echo.ServeHTTP(response, req)
		return response
	}
	for range 2 {
		response := prepare(`{"account_id":"destination","output_profile":"bluesky.post"}`)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var output PrepareMediaImageOutput
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
		require.Equal(t, "ready", output.Body.Status)
		var dimensions struct {
			Media struct {
				Width  int `json:"width"`
				Height int `json:"height"`
			} `json:"media"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &dimensions))
		require.Positive(t, dimensions.Media.Width)
		require.Positive(t, dimensions.Media.Height)
		require.LessOrEqual(t, dimensions.Media.Width*dimensions.Media.Height, 2048)
		require.Equal(t, "image/jpeg", output.Body.Media.MimeType)
		var fitted models.MediaAttachment
		require.NoError(t, srv.db.NewSelect().Model(&fitted).Where("id = ?", output.Body.Media.ID).Scan(t.Context()))
		require.LessOrEqual(t, fitted.Width*fitted.Height, 2048)
		var thumbnails Thumbnails
		require.NoError(t, json.Unmarshal([]byte(fitted.ThumbnailsJSON), &thumbnails))
		require.NotEmpty(t, thumbnails.SM)
		require.NotEmpty(t, thumbnails.MD)
		thumbnailFile, err := storage.Open(t.Context(), thumbnails.MD)
		require.NoError(t, err)
		config, _, err := image.DecodeConfig(thumbnailFile)
		require.NoError(t, err)
		require.NoError(t, thumbnailFile.Close())
		require.LessOrEqual(t, config.Width, 400)
		require.LessOrEqual(t, config.Height, 400)

		require.NotEqual(t, original.ID, output.Body.Media.ID)
		require.Equal(t, original.ID, output.Body.Media.ParentMediaID)
		require.Equal(t, "image_fit", output.Body.Media.Source)
		require.Equal(t, "Source description", output.Body.Media.AltText)
		if derivativeID != "" {
			require.Equal(t, derivativeID, output.Body.Media.ID)
		}
		derivativeID = output.Body.Media.ID
	}
	foreign := prepare(`{"account_id":"other-workspace","output_profile":"bluesky.post"}`)
	require.Equal(t, http.StatusNotFound, foreign.Code, foreign.Body.String())
	require.Contains(t, foreign.Body.String(), "not available in this Workspace")
	require.Equal(t, http.StatusUnprocessableEntity, prepare(`{"account_id":"destination","output_profile":"bluesky.video"}`).Code)
	require.Equal(t, http.StatusUnprocessableEntity, prepare(`{"account_id":"destination","output_profile":"invented"}`).Code)
	file, err := storage.Open(t.Context(), filepath.Base(original.FilePath))
	require.NoError(t, err)
	saved, err := io.ReadAll(file)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	require.Equal(t, content.Bytes(), saved)
	mcp := &MCPHandler{db: srv.db, mediaHandler: srv.handler}
	ctx := contextWithMCPPrincipal(t.Context(), &middleware.Principal{UserID: "user-1"})
	result, rpcErr := mcp.callMCPOperation(ctx, "user-1", mcpToolPrepareImage, map[string]any{"media_id": original.ID, "account_id": "destination", "output_profile": "bluesky.post"})
	require.Nil(t, rpcErr)
	require.NotNil(t, result)
	structured, ok := result.(map[string]any)
	require.True(t, ok, "prepare_media_image must return structured content")
	structuredJSON, err := json.Marshal(structured["structuredContent"])
	require.NoError(t, err)
	// The MCP structured body is the flattened response body, not the Huma
	// envelope, so decode the body fields directly.
	var mcpOutput struct {
		Media  MediaUploadResult `json:"media"`
		Status string            `json:"status"`
	}
	require.NoError(t, json.Unmarshal(structuredJSON, &mcpOutput))
	require.Equal(t, "ready", mcpOutput.Status)
	require.Equal(t, derivativeID, mcpOutput.Media.ID, "MCP must return the reusable fitted derivative")
	require.Equal(t, original.ID, mcpOutput.Media.ParentMediaID)
	require.Equal(t, "image_fit", mcpOutput.Media.Source)
	_, rpcErr = mcp.callMCPOperation(contextWithMCPWorkspaceScope(ctx, "different"), "user-1", mcpToolPrepareImage, map[string]any{"media_id": original.ID, "account_id": "destination", "output_profile": "bluesky.post"})
	require.NotNil(t, rpcErr)
	_, err = srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, prepare(`{"account_id":"destination","output_profile":"bluesky.post"}`).Code)
	_, rpcErr = mcp.callMCPOperation(ctx, "user-1", mcpToolPrepareImage, map[string]any{"media_id": original.ID, "account_id": "destination", "output_profile": "bluesky.post"})
	require.NotNil(t, rpcErr)
}
