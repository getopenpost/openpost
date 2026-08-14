package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type instanceAdminTestServer struct {
	echo        *echo.Echo
	db          *bun.DB
	authService *auth.Service
	handler     *InstanceAdminHandler
}

func browserSessionTestAuthenticator() middleware.Authenticator {
	return workspaceTestAuthenticator{
		"web-token": {
			UserID: "user-1", Email: "user@example.com", SessionID: "browser-session",
		},
	}
}

func unboundCLIFullTestAuthenticator() middleware.Authenticator {
	return workspaceTestAuthenticator{
		"web-token": {
			UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeCLI, TokenID: "cli-token",
		},
	}
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
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.BillingSubscription)(nil),
		(*models.UserSession)(nil),
		(*models.UserImpersonationGrant)(nil),
		(*models.UserImpersonationGrantOrganization)(nil),
	)
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	users := []models.User{
		{ID: "user-1", Email: "admin@example.com", DisplayName: "Instance Admin", PasswordHash: "hash", IsAdmin: isAdmin, CreatedAt: now.AddDate(0, 0, -40)},
		{ID: "user-2", Email: "newest@example.com", DisplayName: "Newest User", PasswordHash: "hash", CreatedAt: now.AddDate(0, 0, -1)},
		{ID: "user-3", Email: "second@example.com", PasswordHash: "hash", CreatedAt: now.AddDate(0, 0, -2)},
	}
	_, err := db.NewInsert().Model(&users).Exec(context.Background())
	require.NoError(t, err)

	organization := &models.Organization{
		ID: "organization-1", Name: "Team", CreatedByID: "user-2", CreatedAt: now.AddDate(0, 0, -20),
	}
	_, err = db.NewInsert().Model(organization).Exec(context.Background())
	require.NoError(t, err)
	organizationMembers := []models.OrganizationMember{
		{OrganizationID: organization.ID, UserID: "user-2", Role: models.OrganizationRoleOwner, CreatedAt: now.AddDate(0, 0, -20)},
		{OrganizationID: organization.ID, UserID: "user-3", Role: models.OrganizationRoleMember, CreatedAt: now.AddDate(0, 0, -10)},
	}
	_, err = db.NewInsert().Model(&organizationMembers).Exec(context.Background())
	require.NoError(t, err)

	workspaces := []models.Workspace{
		{ID: "workspace-1", OrganizationID: organization.ID, Name: "First workspace", CreatedAt: now.AddDate(0, 0, -20)},
		{ID: "workspace-2", OrganizationID: organization.ID, Name: "Second workspace", CreatedAt: now.AddDate(0, 0, -10)},
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
	_, err = db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         organization.ID,
		Provider:               "paddle",
		ProviderCustomerID:     "customer-1",
		ProviderSubscriptionID: "subscription-1",
		Status:                 "active",
		PlanID:                 "founder",
		EntitlementSnapshot:    "{}",
		RawPayload:             "{}",
		CreatedAt:              now.AddDate(0, 0, -15),
		UpdatedAt:              now.AddDate(0, 0, -1),
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "social-account-1", WorkspaceID: "workspace-1", Slug: "openpost", Platform: "x",
		AccountID: "provider-account-1", AccessTokenEnc: []byte("encrypted"), IsActive: true,
		CreatedAt: now.AddDate(0, 0, -10),
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.UserSession{
		ID: "target-session", UserID: "user-2", UserAgent: "Test Browser",
		ExpiresAt: now.AddDate(0, 0, 5), LastUsedAt: now.Add(-2 * time.Hour),
		CreatedAt: now.AddDate(0, 0, -1),
	}).Exec(context.Background())
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
	authService := auth.NewService("instance-admin-test-secret")
	handler := NewInstanceAdminHandler(
		db,
		authenticator,
		authService,
		sessions.NewService(db),
		"https://app.openpost.test",
	)
	handler.now = func() time.Time { return now }
	handler.RegisterRoutes(api)
	return &instanceAdminTestServer{echo: e, db: db, authService: authService, handler: handler}
}

func (s *instanceAdminTestServer) get(t *testing.T, path, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *instanceAdminTestServer) post(
	t *testing.T,
	path string,
	body any,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestInstanceAdminOverviewReturnsThirtyDayActivity(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, browserSessionTestAuthenticator())
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

	srv := newInstanceAdminTestServer(t, true, browserSessionTestAuthenticator())
	defaultResp := srv.get(t, "/api/v1/admin/users", "web-token")
	require.Equal(t, http.StatusOK, defaultResp.Code, defaultResp.Body.String())
	var defaultPage InstanceUserPage
	require.NoError(t, json.Unmarshal(defaultResp.Body.Bytes(), &defaultPage))
	require.Equal(t, 1, defaultPage.Page)
	require.Equal(t, 25, defaultPage.PerPage)
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
	require.Equal(t, []string{"founder"}, first.Users[0].PlanIDs)
	require.Equal(t, 1, first.Users[0].OrganizationCount)
	require.Equal(t, 2, first.Users[0].WorkspaceCount)
	require.Equal(t, 1, first.Users[0].SocialAccountCount)
	require.Equal(t, 2, first.Users[0].PublicationCount)
	require.NotEmpty(t, first.Users[0].LastActiveAt)
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

func TestInstanceAdminUsersSupportSearchAndSort(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, browserSessionTestAuthenticator())
	resp := srv.get(
		t,
		"/api/v1/admin/users?search=second%40example.com&sort=email&direction=asc",
		"web-token",
	)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var page InstanceUserPage
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &page))
	require.Equal(t, 1, page.Total)
	require.Len(t, page.Users, 1)
	require.Equal(t, "user-3", page.Users[0].ID)
	require.Equal(t, []string{"founder"}, page.Users[0].PlanIDs)
}

func TestInstanceAdminCreatesAndConsumesOneUseImpersonationLink(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, workspaceTestAuthenticator{
		"admin-session-token": {
			UserID: "user-1", Email: "admin@example.com", SessionID: "admin-session",
		},
	})
	now := time.Now().UTC().Truncate(time.Second)
	srv.handler.now = func() time.Time { return now }
	createResp := srv.post(
		t,
		"/api/v1/admin/users/user-2/impersonation-links",
		map[string]string{},
		"admin-session-token",
	)
	require.Equal(t, http.StatusOK, createResp.Code, createResp.Body.String())
	var created struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expires_at"`
	}
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &created))
	require.True(t, strings.HasPrefix(created.URL, "https://app.openpost.test/impersonate#code="))
	require.NotEmpty(t, created.ExpiresAt)
	code := strings.TrimPrefix(created.URL, "https://app.openpost.test/impersonate#code=")
	require.NotEmpty(t, code)

	var grant models.UserImpersonationGrant
	require.NoError(t, srv.db.NewSelect().Model(&grant).Scan(t.Context()))
	require.NotEqual(t, code, grant.TokenHash)
	require.Equal(t, "user-1", grant.AdminUserID)
	require.Equal(t, "user-2", grant.TargetUserID)
	require.True(t, grant.UsedAt.IsZero())
	var scope models.UserImpersonationGrantOrganization
	require.NoError(t, srv.db.NewSelect().Model(&scope).Scan(t.Context()))
	require.Equal(t, grant.ID, scope.GrantID)
	require.Equal(t, "organization-1", scope.OrganizationID)

	consumeResp := srv.post(
		t,
		"/api/v1/auth/impersonation",
		map[string]string{"code": code},
		"",
	)
	require.Equal(t, http.StatusOK, consumeResp.Code, consumeResp.Body.String())
	require.Contains(t, consumeResp.Header().Get("Set-Cookie"), "openpost_session=")
	require.Contains(t, consumeResp.Header().Get("Set-Cookie"), "HttpOnly")
	cookies := consumeResp.Result().Cookies()
	require.Len(t, cookies, 1)
	claims, err := srv.authService.ValidateToken(cookies[0].Value)
	require.NoError(t, err)
	require.Equal(t, "user-2", claims.UserID)
	require.NotEmpty(t, claims.SessionID)

	require.NoError(t, srv.db.NewSelect().Model(&grant).WherePK().Scan(t.Context()))
	require.False(t, grant.UsedAt.IsZero())

	secondConsume := srv.post(
		t,
		"/api/v1/auth/impersonation",
		map[string]string{"code": code},
		"",
	)
	require.Equal(t, http.StatusBadRequest, secondConsume.Code, secondConsume.Body.String())
}

func TestInstanceAdminImpersonationRequiresBrowserSessionAndNonAdminTarget(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, workspaceTestAuthenticator{
		"api-token": {
			UserID: "user-1", Email: "admin@example.com", Scope: apitokens.ScopeCLI, TokenID: "cli-token",
		},
		"admin-session-token": {
			UserID: "user-1", Email: "admin@example.com", SessionID: "admin-session",
		},
	})
	noSession := srv.post(
		t,
		"/api/v1/admin/users/user-2/impersonation-links",
		map[string]string{},
		"api-token",
	)
	require.Equal(t, http.StatusForbidden, noSession.Code, noSession.Body.String())
	require.Contains(t, noSession.Body.String(), "browser session")

	adminTarget := srv.post(
		t,
		"/api/v1/admin/users/user-1/impersonation-links",
		map[string]string{},
		"admin-session-token",
	)
	require.Equal(t, http.StatusConflict, adminTarget.Code, adminTarget.Body.String())
}

func TestInstanceAdminOverviewAndUsersRejectBearerAdminToken(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, unboundCLIFullTestAuthenticator())
	for _, path := range []string{"/api/v1/admin/overview", "/api/v1/admin/users"} {
		response := srv.get(t, path, "web-token")
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "browser session")
	}
}

func TestInstanceAdminImpersonationConsumptionRejectsSignedInBrowser(t *testing.T) {
	t.Parallel()

	srv := newInstanceAdminTestServer(t, true, testAuthenticator{})
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		"/api/v1/auth/impersonation",
		strings.NewReader(`{"code":"unused-code"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "openpost_session", Value: "existing-session"})
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)

	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "private browser window")
}

func TestInstanceAdminRoutesRejectNonAdmin(t *testing.T) {
	t.Parallel()

	nonAdmin := newInstanceAdminTestServer(t, false, browserSessionTestAuthenticator())
	nonAdminResp := nonAdmin.get(t, "/api/v1/admin/users", "web-token")
	require.Equal(t, http.StatusForbidden, nonAdminResp.Code, nonAdminResp.Body.String())
	require.Contains(t, nonAdminResp.Body.String(), "instance admin role required")
}

func TestInstanceAdminRoutesRejectScopedCredentials(t *testing.T) {
	t.Parallel()

	scoped := newInstanceAdminTestServer(t, true, workspaceTestAuthenticator{
		"scoped-token": {
			UserID: "user-1", Email: "admin@example.com", WorkspaceID: "workspace-1", SessionID: "browser-session",
		},
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
