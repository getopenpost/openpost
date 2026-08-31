package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func newJobsTestServer(t *testing.T) *jobsTestServer {
	return newJobsTestServerWithAuthenticator(t, testAuthenticator{})
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
		{ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC()},
		{ID: "user-2", Email: "other@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC()},
		{ID: "admin-1", Email: "admin@example.com", PasswordHash: "hash", IsAdmin: true, CreatedAt: time.Now().UTC()},
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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

func TestListJobsPaginatesVisibleJobsWithHeaders(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServer(t)
	srv.seedJobs(t)

	resp := srv.getJSON(t, "/api/v1/jobs?limit=2&offset=1")

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

	resp := srv.getJSON(t, "/api/v1/jobs?workspace_id=ws-1&status=pending&limit=1")

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

func TestGetJobReturnsSafeWorkspaceJobForBrowserSession(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServerWithAuthenticator(t, jobsAuthenticator{})
	srv.seedJobs(t)

	resp := srv.getJSONWithToken(t, "/api/v1/jobs/job-1", "browser-session")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out JobResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "job-1", out.ID)
	require.Equal(t, jobTypePublishPublication, out.Type)
	require.Equal(t, "pending", out.Status)
	require.Equal(t, "publication-1", out.PublicationID)
	require.Empty(t, out.Payload)
}

func TestGetJobEnforcesWorkspaceAccessForBrowserSession(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServerWithAuthenticator(t, jobsAuthenticator{})
	srv.seedJobs(t)

	resp := srv.getJSONWithToken(t, "/api/v1/jobs/job-1", "foreign-browser-session")

	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
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

func TestGetJobIncludesPayloadOnlyForInstanceAdminBrowserSession(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServerWithAuthenticator(t, jobsAuthenticator{})
	srv.seedJobs(t)

	resp := srv.getJSONWithToken(t, "/api/v1/jobs/job-1", "admin-session")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out JobResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, `{"publication_id":"publication-1"}`, out.Payload)
}

func TestListJobsRejectsNegativeOffset(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServer(t)

	resp := srv.getJSON(t, "/api/v1/jobs?offset=-1")

	require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "offset must be greater than or equal to 0")
}

func TestListJobsCursorAndRunRangeReachOlderRecordsWithoutDuplicates(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServer(t)
	srv.seedJobs(t)

	first := srv.getJSON(t, "/api/v1/jobs?workspace_id=ws-1&limit=2")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	require.Equal(t, "true", first.Header().Get("X-Has-More"))
	cursor := first.Header().Get("X-Next-Cursor")
	require.NotEmpty(t, cursor)
	var firstPage []JobResponse
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstPage))
	require.Equal(t, []string{"job-4", "job-3"}, []string{firstPage[0].ID, firstPage[1].ID})

	second := srv.getJSON(
		t,
		"/api/v1/jobs?workspace_id=ws-1&limit=2&cursor="+url.QueryEscape(cursor),
	)
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	require.Equal(t, "false", second.Header().Get("X-Has-More"))
	var secondPage []JobResponse
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &secondPage))
	require.Equal(t, []string{"job-2", "job-1"}, []string{secondPage[0].ID, secondPage[1].ID})

	rangeResponse := srv.getJSON(
		t,
		"/api/v1/jobs?workspace_id=ws-1&run_from=2026-07-01T12:02:00Z&run_before=2026-07-01T12:04:00Z",
	)
	require.Equal(t, http.StatusOK, rangeResponse.Code, rangeResponse.Body.String())
	var rangePage []JobResponse
	require.NoError(t, json.Unmarshal(rangeResponse.Body.Bytes(), &rangePage))
	require.Equal(t, []string{"job-3", "job-2"}, []string{rangePage[0].ID, rangePage[1].ID})
}

func TestListJobsIncludesCanonicalPublicationJobsInWorkspaceScope(t *testing.T) {
	t.Parallel()

	srv := newJobsTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-canonical", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Launch",
		ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch",
		Status: models.PublicationStatusFailed,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-external", WorkspaceID: "ws-2", CreatedByID: "user-2", Title: "Other",
		ContentProfile: models.ContentProfileShortText, SourceText: "Other", SourceContent: "Other",
		Status: models.PublicationStatusFailed,
	}).Exec(ctx)
	require.NoError(t, err)
	jobRows := []models.Job{
		{
			ID: "publication-job", Type: "publish_publication", ScopeID: "publication-canonical", Payload: `{"publication_id":"publication-canonical"}`,
			Status: "failed", RunAt: time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC), MaxAttempts: 3,
		},
		{
			ID: "publication-job-stale-payload", Type: "publish_publication", ScopeID: "publication-external", Payload: `{"publication_id":"publication-canonical"}`,
			Status: "failed", RunAt: time.Date(2026, 7, 1, 13, 0, 0, 0, time.UTC), MaxAttempts: 3,
		},
	}
	_, err = srv.db.NewInsert().Model(&jobRows).Exec(ctx)
	require.NoError(t, err)

	response := srv.getJSON(t, "/api/v1/jobs?workspace_id=ws-1&status=failed")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var jobs []JobResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &jobs))
	require.Len(t, jobs, 1)
	require.Equal(t, "publication-job", jobs[0].ID)
	require.Equal(t, "publication-canonical", jobs[0].PublicationID)
	require.Empty(t, jobs[0].Payload)
}

func TestListJobsUsesCanonicalScopeForMigratedLegacyHistory(t *testing.T) {
	srv := newJobsTestServer(t)
	ctx := t.Context()
	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-history", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "History",
		ContentProfile: models.ContentProfileShortText, SourceText: "History", SourceContent: "History",
		Status: models.PublicationStatusPublished,
	}).Exec(ctx)
	require.NoError(t, err)

	const legacyHistoryCount = 4
	jobs := make([]models.Job, 0, legacyHistoryCount+3)
	for index := range legacyHistoryCount {
		jobs = append(jobs, models.Job{
			ID: fmt.Sprintf("legacy-history-%04d", index), Type: jobTypePublishPost, ScopeID: "publication-history",
			Payload: `{"post_id":"retained-legacy-id"}`, Status: "completed",
			RunAt: now.Add(time.Duration(index) * time.Second), MaxAttempts: 3,
		})
	}
	jobs = append(jobs,
		models.Job{
			ID: "legacy-publication-history", Type: jobTypePublishPublication,
			Payload: `{"publication_id":"publication-history"}`, Status: "completed",
			RunAt: now.Add(legacyHistoryCount * time.Second), MaxAttempts: 3,
		},
		models.Job{
			ID: "legacy-foreign-history", Type: jobTypePublishPost, ScopeID: "publication-foreign",
			Payload: `{"post_id":"retained-foreign-id"}`, Status: "completed",
			RunAt: now.Add((legacyHistoryCount + 1) * time.Second), MaxAttempts: 3,
		},
		models.Job{
			ID: "legacy-malformed-history", Type: jobTypePublishPost,
			Payload: `{"post_id":"post-1"} broken`, Status: "completed",
			RunAt: now.Add((legacyHistoryCount + 2) * time.Second), MaxAttempts: 3,
		},
		models.Job{
			ID: "legacy-nested-history", Type: jobTypePublishPost,
			Payload: `{"nested":{"post_id":"post-1"}}`, Status: "completed",
			RunAt: now.Add((legacyHistoryCount + 3) * time.Second), MaxAttempts: 3,
		},
	)
	_, err = srv.db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	response := srv.getJSON(t, "/api/v1/jobs?workspace_id=ws-1&status=completed&limit=1")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, fmt.Sprintf("%d", legacyHistoryCount+1), response.Header().Get("X-Total-Count"))
	var page []JobResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
	require.Len(t, page, 1)
	require.Equal(t, "legacy-publication-history", page[0].ID)
	require.Equal(t, "publication-history", page[0].PublicationID)
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

func (s *jobsTestServer) getJSON(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	return s.getJSONWithToken(t, path, "web-token")
}

func (s *jobsTestServer) getJSONWithToken(t *testing.T, path, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}
