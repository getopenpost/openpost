package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type postMediaValidationTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newPostMediaValidationTestServer(t *testing.T) *postMediaValidationTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.Job)(nil),
		(*models.ThreadDraft)(nil),
		(*models.UsageCounter)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Validation"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{ID: "x-1", WorkspaceID: "ws-1", Slug: "x", Platform: "x", AccountID: "x-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "facebook-1", WorkspaceID: "ws-1", Slug: "facebook", Platform: "facebook", AccountID: "fb-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "instagram-1", WorkspaceID: "ws-1", Slug: "instagram", Platform: "instagram", AccountID: "ig-1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "youtube-1", WorkspaceID: "ws-1", Slug: "youtube", Platform: "youtube", AccountID: "yt-1", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
	media := []models.MediaAttachment{
		{ID: "image-1", WorkspaceID: "ws-1", FilePath: "image-1.png", MimeType: "image/png", Size: 1024, OriginalFilename: "image-1.png", FileHash: "hash-image-1"},
		{ID: "image-2", WorkspaceID: "ws-1", FilePath: "image-2.png", MimeType: "image/png", Size: 2048, OriginalFilename: "image-2.png", FileHash: "hash-image-2"},
		{ID: "video-1", WorkspaceID: "ws-1", FilePath: "video-1.mp4", MimeType: "video/mp4", Size: 4096, OriginalFilename: "video-1.mp4", FileHash: "hash-video-1"},
	}
	_, err = db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewPostHandler(db, testAuthenticator{})
	handler.CreatePost(api)
	handler.CreateThread(api)
	handler.UpdatePost(api)

	return &postMediaValidationTestServer{echo: e, db: db}
}

func (s *postMediaValidationTestServer) request(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	payload := &bytes.Buffer{}
	if body != nil {
		require.NoError(t, json.NewEncoder(payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, payload)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestCreateDraftAllowsProviderMediaValidationErrors(t *testing.T) {
	t.Parallel()

	srv := newPostMediaValidationTestServer(t)
	resp := srv.request(t, http.MethodPost, "/api/v1/posts", map[string]any{
		"workspace_id":       "ws-1",
		"content":            "Draft first, media later",
		"social_account_ids": []string{"instagram-1"},
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
}

func TestCreateScheduledPostRejectsProviderMediaErrors(t *testing.T) {
	t.Parallel()

	srv := newPostMediaValidationTestServer(t)
	scheduledAt := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)
	resp := srv.request(t, http.MethodPost, "/api/v1/posts", map[string]any{
		"workspace_id":         "ws-1",
		"content":              "Needs media",
		"scheduled_at":         scheduledAt,
		"social_account_ids":   []string{"instagram-1"},
		"random_delay_minutes": 0,
	})

	require.Equal(t, http.StatusBadRequest, resp.Code)
	require.Contains(t, resp.Body.String(), "Instagram publishing requires 1-10 image or video attachments")
}

func TestScheduleDraftRejectsProviderMediaErrors(t *testing.T) {
	t.Parallel()

	srv := newPostMediaValidationTestServer(t)
	createResp := srv.request(t, http.MethodPost, "/api/v1/posts", map[string]any{
		"workspace_id":       "ws-1",
		"content":            "YouTube draft",
		"social_account_ids": []string{"youtube-1"},
		"media_ids":          []string{"image-1"},
	})
	require.Equal(t, http.StatusOK, createResp.Code, createResp.Body.String())
	var created PostResponse
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &created))

	resp := srv.request(t, http.MethodPatch, "/api/v1/posts/"+created.ID, map[string]any{
		"scheduled_at": time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339),
	})

	require.Equal(t, http.StatusBadRequest, resp.Code)
	require.Contains(t, resp.Body.String(), "YouTube publishing supports video attachments only")
}

func TestUpdateScheduledPostRejectsNewDestinationMediaErrors(t *testing.T) {
	t.Parallel()

	srv := newPostMediaValidationTestServer(t)
	createResp := srv.request(t, http.MethodPost, "/api/v1/posts", map[string]any{
		"workspace_id":       "ws-1",
		"content":            "Two images are okay for X",
		"scheduled_at":       time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339),
		"social_account_ids": []string{"x-1"},
		"media_ids":          []string{"image-1", "image-2"},
	})
	require.Equal(t, http.StatusOK, createResp.Code, createResp.Body.String())
	var created PostResponse
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &created))

	resp := srv.request(t, http.MethodPatch, "/api/v1/posts/"+created.ID, map[string]any{
		"social_account_ids": []string{"youtube-1"},
	})

	require.Equal(t, http.StatusBadRequest, resp.Code)
	require.Contains(t, resp.Body.String(), "YouTube publishing currently requires exactly one video attachment")
}
