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
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type instanceAdminTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newInstanceAdminTestServer(
	t *testing.T,
	isAdmin bool,
	authenticator middleware.Authenticator,
) *instanceAdminTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
	)
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	users := []models.User{
		{ID: "user-1", Email: "admin@example.com", DisplayName: "Instance Admin", PasswordHash: "hash", IsAdmin: isAdmin, CreatedAt: now.AddDate(0, 0, -40)},
		{ID: "user-2", Email: "newest@example.com", DisplayName: "Newest User", PasswordHash: "hash", CreatedAt: now.AddDate(0, 0, -1)},
		{ID: "user-3", Email: "second@example.com", PasswordHash: "hash", CreatedAt: now.AddDate(0, 0, -2)},
	}
	_, err := db.NewInsert().Model(&users).Exec(context.Background())
	require.NoError(t, err)

	workspaces := []models.Workspace{
		{ID: "workspace-1", Name: "First workspace", CreatedAt: now.AddDate(0, 0, -20)},
		{ID: "workspace-2", Name: "Second workspace", CreatedAt: now.AddDate(0, 0, -10)},
	}
	_, err = db.NewInsert().Model(&workspaces).Exec(context.Background())
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "workspace-1", UserID: "user-2", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "workspace-2", UserID: "user-2", Role: models.WorkspaceRoleEditor},
		{WorkspaceID: "workspace-1", UserID: "user-3", Role: models.WorkspaceRoleViewer},
	}
	_, err = db.NewInsert().Model(&members).Exec(context.Background())
	require.NoError(t, err)

	publications := []models.Publication{
		{
			ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-2", Title: "Published",
			SourceContent: "Published", Status: models.PublicationStatusPublished,
			ActualRunAt: now.AddDate(0, 0, -3), CreatedAt: now.AddDate(0, 0, -3), UpdatedAt: now.AddDate(0, 0, -3),
		},
		{
			ID: "publication-2", WorkspaceID: "workspace-1", CreatedByID: "user-2", Title: "Failed",
			SourceContent: "Failed", Status: models.PublicationStatusFailed,
			ActualRunAt: now.AddDate(0, 0, -2), CreatedAt: now.AddDate(0, 0, -2), UpdatedAt: now.AddDate(0, 0, -2),
		},
	}
	_, err = db.NewInsert().Model(&publications).Exec(context.Background())
	require.NoError(t, err)
	renditions := []models.Rendition{
		{
			ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
			Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished,
		},
		{
			ID: "rendition-2", PublicationID: "publication-2", SocialAccountID: "account-1",
			Platform: "x", Profile: "short_text", Status: models.RenditionStatusFailed,
		},
	}
	_, err = db.NewInsert().Model(&renditions).Exec(context.Background())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewInstanceAdminHandler(db, authenticator)
	handler.now = func() time.Time { return now }
	handler.RegisterRoutes(api)
	return &instanceAdminTestServer{echo: e, db: db}
}

func (s *instanceAdminTestServer) get(t *testing.T, path, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestInstanceAdminOverviewReturnsThirtyDayActivity(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, testAuthenticator{})
	resp := srv.get(t, "/api/v1/admin/overview", "web-token")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var body InstanceOverviewResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Equal(t, 3, body.TotalUsers)
	require.Equal(t, 2, body.NewUsersLast30Days)
	require.Equal(t, 2, body.TotalWorkspaces)
	require.Equal(t, 1, body.PublishedLast30Days)
	require.Len(t, body.UserRegistrationTrend, instanceAdminTrendDays)
	require.Len(t, body.PublicationTrend, instanceAdminTrendDays)
	require.Equal(t, 2, sumInstanceMetric(body.UserRegistrationTrend))
	require.Equal(t, 1, sumInstanceMetric(body.PublicationTrend))
	require.Equal(t, "2026-06-29", body.UserRegistrationTrend[0].Date)
	require.Equal(t, "2026-07-28", body.UserRegistrationTrend[len(body.UserRegistrationTrend)-1].Date)
}

func TestInstanceAdminUsersArePaginatedNewestFirst(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, testAuthenticator{})
	defaultResp := srv.get(t, "/api/v1/admin/users", "web-token")
	require.Equal(t, http.StatusOK, defaultResp.Code, defaultResp.Body.String())
	var defaultPage InstanceUserPage
	require.NoError(t, json.Unmarshal(defaultResp.Body.Bytes(), &defaultPage))
	require.Equal(t, 1, defaultPage.Page)
	require.Equal(t, 20, defaultPage.PerPage)
	require.Equal(t, 1, defaultPage.TotalPages)
	require.Len(t, defaultPage.Users, 3)

	firstResp := srv.get(t, "/api/v1/admin/users?page=1&per_page=2", "web-token")

	require.Equal(t, http.StatusOK, firstResp.Code, firstResp.Body.String())
	var first InstanceUserPage
	require.NoError(t, json.Unmarshal(firstResp.Body.Bytes(), &first))
	require.Equal(t, 3, first.Total)
	require.Equal(t, 1, first.Page)
	require.Equal(t, 2, first.PerPage)
	require.Equal(t, 2, first.TotalPages)
	require.Len(t, first.Users, 2)
	require.Equal(t, "user-2", first.Users[0].ID)
	require.Equal(t, 2, first.Users[0].WorkspaceCount)
	require.Equal(t, "user-3", first.Users[1].ID)
	require.Equal(t, 1, first.Users[1].WorkspaceCount)

	secondResp := srv.get(t, "/api/v1/admin/users?page=2&per_page=2", "web-token")
	require.Equal(t, http.StatusOK, secondResp.Code, secondResp.Body.String())
	var second InstanceUserPage
	require.NoError(t, json.Unmarshal(secondResp.Body.Bytes(), &second))
	require.Len(t, second.Users, 1)
	require.Equal(t, "user-1", second.Users[0].ID)
	require.True(t, second.Users[0].IsAdmin)
}

func TestInstanceAdminRoutesRejectNonAdmin(t *testing.T) {
	t.Parallel()

	nonAdmin := newInstanceAdminTestServer(t, false, testAuthenticator{})
	nonAdminResp := nonAdmin.get(t, "/api/v1/admin/users", "web-token")
	require.Equal(t, http.StatusForbidden, nonAdminResp.Code, nonAdminResp.Body.String())
	require.Contains(t, nonAdminResp.Body.String(), "instance admin role required")
}

func TestInstanceAdminRoutesRejectScopedCredentials(t *testing.T) {
	t.Parallel()

	scoped := newInstanceAdminTestServer(t, true, workspaceTestAuthenticator{
		"scoped-token": {UserID: "user-1", Email: "admin@example.com", WorkspaceID: "workspace-1"},
	})
	scopedResp := scoped.get(t, "/api/v1/admin/overview", "scoped-token")
	require.Equal(t, http.StatusForbidden, scopedResp.Code, scopedResp.Body.String())
	require.Contains(t, scopedResp.Body.String(), "unscoped credentials")
}

func sumInstanceMetric(metrics []InstanceDailyMetric) int {
	total := 0
	for _, metric := range metrics {
		total += metric.Value
	}
	return total
}
