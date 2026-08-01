package handlers

import (
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

type jobsTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newJobsTestServer(t *testing.T) *jobsTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Post)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-2", Name: "Other"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	posts := []models.Post{
		{ID: "post-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "one", Status: statusScheduled},
		{ID: "post-2", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "two", Status: statusScheduled},
		{ID: "post-3", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "three", Status: statusScheduled},
		{ID: "post-4", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "four", Status: statusScheduled},
		{ID: "post-foreign", WorkspaceID: "ws-2", CreatedByID: "user-2", Content: "foreign", Status: statusScheduled},
	}
	_, err = db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewJobHandler(db, testAuthenticator{}).RegisterRoutes(api)
	return &jobsTestServer{echo: e, db: db}
}

func TestListJobsPaginatesVisibleJobsWithHeaders(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServer(t)
	srv.seedJobs(t)

	resp := srv.getJSON(t, "/api/v1/jobs?limit=2&offset=1", "web-token")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, "4", resp.Header().Get("X-Total-Count"))
	require.Equal(t, "2", resp.Header().Get("X-Limit"))
	require.Equal(t, "1", resp.Header().Get("X-Offset"))
	require.Equal(t, "3", resp.Header().Get("X-Next-Offset"))
	require.Equal(t, "true", resp.Header().Get("X-Has-More"))

	var out []JobResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out, 2)
	require.Equal(t, "job-3", out[0].ID)
	require.Equal(t, "job-2", out[1].ID)
}

func TestListJobsCountsFilteredWorkspaceScope(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServer(t)
	srv.seedJobs(t)

	resp := srv.getJSON(t, "/api/v1/jobs?workspace_id=ws-1&status=pending&limit=1", "web-token")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, "2", resp.Header().Get("X-Total-Count"))
	require.Equal(t, "1", resp.Header().Get("X-Limit"))
	require.Equal(t, "0", resp.Header().Get("X-Offset"))
	require.Equal(t, "1", resp.Header().Get("X-Next-Offset"))
	require.Equal(t, "true", resp.Header().Get("X-Has-More"))

	var out []JobResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out, 1)
	require.Equal(t, "pending", out[0].Status)
	require.Equal(t, "", out[0].Payload)
}

func TestListJobsRejectsNegativeOffset(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServer(t)

	resp := srv.getJSON(t, "/api/v1/jobs?offset=-1", "web-token")

	require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "offset must be greater than or equal to 0")
}

func (s *jobsTestServer) seedJobs(t *testing.T) {
	t.Helper()

	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	jobs := []models.Job{
		{ID: "job-1", Type: "publish_post", Payload: `{"post_id":"post-1"}`, Status: "pending", RunAt: now.Add(time.Minute), MaxAttempts: 3},
		{ID: "job-2", Type: "publish_post", Payload: `{"post_id":"post-2"}`, Status: "completed", RunAt: now.Add(2 * time.Minute), MaxAttempts: 3},
		{ID: "job-3", Type: "publish_post", Payload: `{"post_id":"post-3"}`, Status: "pending", RunAt: now.Add(3 * time.Minute), MaxAttempts: 3},
		{ID: "job-4", Type: "publish_post", Payload: `{"post_id":"post-4"}`, Status: "failed", RunAt: now.Add(4 * time.Minute), MaxAttempts: 3},
		{ID: "job-foreign", Type: "publish_post", Payload: `{"post_id":"post-foreign"}`, Status: "pending", RunAt: now.Add(5 * time.Minute), MaxAttempts: 3},
	}
	_, err := s.db.NewInsert().Model(&jobs).Exec(context.Background())
	require.NoError(t, err)
}

func (s *jobsTestServer) getJSON(t *testing.T, path string, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}
