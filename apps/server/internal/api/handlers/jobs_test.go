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
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type jobsTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newJobsTestServerWithAuthenticator(t *testing.T, authenticator middleware.Authenticator) *jobsTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	users := []models.User{
		{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"},
		{ID: "user-2", Email: "other@example.com", PasswordHash: "hash"},
		{ID: "admin-1", Email: "admin@example.com", PasswordHash: "hash", IsAdmin: true},
	}
	for index := range users {
		_, err := db.NewInsert().Model(&users[index]).Exec(ctx)
		require.NoError(t, err)
	}
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-2", Name: "Other"}).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "ws-2", UserID: "user-2", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "ws-1", UserID: "admin-1", Role: models.WorkspaceRoleAdmin},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)

	publications := []models.Publication{
		{ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", SourceText: "one", Status: models.PublicationStatusScheduled},
		{ID: "publication-2", WorkspaceID: "ws-1", CreatedByID: "user-1", SourceText: "two", Status: models.PublicationStatusScheduled},
		{ID: "publication-3", WorkspaceID: "ws-1", CreatedByID: "user-1", SourceText: "three", Status: models.PublicationStatusScheduled},
		{ID: "publication-4", WorkspaceID: "ws-1", CreatedByID: "user-1", SourceText: "four", Status: models.PublicationStatusScheduled},
		{ID: "publication-foreign", WorkspaceID: "ws-2", CreatedByID: "user-2", SourceText: "foreign", Status: models.PublicationStatusScheduled},
	}
	_, err = db.NewInsert().Model(&publications).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewJobHandler(db, authenticator).RegisterRoutes(api)
	return &jobsTestServer{echo: e, db: db}
}

type jobsAuthenticator struct{}

func (jobsAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	switch token {
	case "browser-session":
		return &middleware.Principal{UserID: "user-1", Email: "user@example.com", SessionID: "session-1"}, nil
	case "foreign-browser-session":
		return &middleware.Principal{UserID: "user-2", Email: "other@example.com", SessionID: "session-2"}, nil
	case "admin-session":
		return &middleware.Principal{UserID: "admin-1", Email: "admin@example.com", SessionID: "admin-session"}, nil
	case "api-read-ws-1":
		return &middleware.Principal{UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeAPIRead, WorkspaceID: "ws-1", TokenID: "api-read-ws-1"}, nil
	case "api-write-ws-1":
		return &middleware.Principal{UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeAPIWrite, WorkspaceID: "ws-1", TokenID: "api-write-ws-1"}, nil
	case "api-read-ws-2":
		return &middleware.Principal{UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeAPIRead, WorkspaceID: "ws-2", TokenID: "api-read-ws-2"}, nil
	default:
		return nil, apitokens.ErrInvalidToken
	}
}

func TestGetJobAllowsWorkspaceBoundAPIReadAndWriteTokens(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServerWithAuthenticator(t, jobsAuthenticator{})
	srv.seedJobs(t)

	readResp := srv.getJSONWithToken(t, "/api/v1/jobs/job-1", "api-read-ws-1")
	require.Equal(t, http.StatusOK, readResp.Code, readResp.Body.String())
	writeResp := srv.getJSONWithToken(t, "/api/v1/jobs/job-2", "api-write-ws-1")
	require.Equal(t, http.StatusOK, writeResp.Code, writeResp.Body.String())
	foreignResp := srv.getJSONWithToken(t, "/api/v1/jobs/job-1", "api-read-ws-2")
	require.Equal(t, http.StatusForbidden, foreignResp.Code, foreignResp.Body.String())

	var out JobResponse
	require.NoError(t, json.Unmarshal(readResp.Body.Bytes(), &out))
	require.Empty(t, out.Payload)
}

func (s *jobsTestServer) seedJobs(t *testing.T) {
	t.Helper()

	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	jobs := []models.Job{
		{ID: "job-1", Type: jobTypePublishPublication, ScopeID: "publication-1", Payload: `{"publication_id":"publication-1"}`, Status: "pending", RunAt: now.Add(time.Minute), MaxAttempts: 3},
		{ID: "job-2", Type: jobTypePublishPublication, ScopeID: "publication-2", Payload: `{"publication_id":"publication-2"}`, Status: "completed", RunAt: now.Add(2 * time.Minute), MaxAttempts: 3},
		{ID: "job-3", Type: jobTypePublishPublication, ScopeID: "publication-3", Payload: `{"publication_id":"publication-3"}`, Status: "pending", RunAt: now.Add(3 * time.Minute), MaxAttempts: 3},
		{ID: "job-4", Type: jobTypePublishPublication, ScopeID: "publication-4", Payload: `{"publication_id":"publication-4"}`, Status: "failed", RunAt: now.Add(4 * time.Minute), MaxAttempts: 3},
		{ID: "job-foreign", Type: jobTypePublishPublication, ScopeID: "publication-foreign", Payload: `{"publication_id":"publication-foreign"}`, Status: "pending", RunAt: now.Add(5 * time.Minute), MaxAttempts: 3},
	}
	_, err := s.db.NewInsert().Model(&jobs).Exec(context.Background())
	require.NoError(t, err)
}

func (s *jobsTestServer) getJSONWithToken(t *testing.T, path, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestInboxCollectionAndReplyJobReceiptsStayWorkspaceScoped(t *testing.T) {
	t.Parallel()
	srv := newJobsTestServerWithAuthenticator(t, jobsAuthenticator{})
	for _, kind := range []string{"messages_sync", "message_send", "engagement_sync", "engagement_action", "engagement_review_action"} {
		job := models.Job{ID: "inbox-" + kind, Type: kind, ScopeID: "ws-1", Status: "pending", Payload: `{"body":"private reply"}`, RunAt: time.Now().UTC()}
		_, err := srv.db.NewInsert().Model(&job).Exec(t.Context())
		require.NoError(t, err)
		response := srv.getJSONWithToken(t, "/api/v1/jobs/"+job.ID, "browser-session")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var receipt JobResponse
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &receipt))
		require.Equal(t, "pending", receipt.Status)
		require.Empty(t, receipt.Payload)
		foreign := srv.getJSONWithToken(t, "/api/v1/jobs/"+job.ID, "api-read-ws-2")
		require.Equal(t, http.StatusForbidden, foreign.Code, foreign.Body.String())
	}
	response := srv.getJSONWithToken(t, "/api/v1/jobs?workspace_id=ws-1", "browser-session")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var receipts []JobResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &receipts))
	require.Len(t, receipts, 5)
}
