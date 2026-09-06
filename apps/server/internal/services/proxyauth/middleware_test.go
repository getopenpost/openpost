package proxyauth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/handlers"
	apimiddleware "github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/proxyauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	testJWTSecret   = "proxy-auth-test-jwt-secret-at-least-32-characters"
	testProxySecret = "proxy-auth-test-shared-secret-at-least-32-characters"
)

func TestMiddlewareAuthenticatesAndProvisionsAProxyUserOnce(t *testing.T) {
	db := proxyAuthTestDB(t)
	authService := auth.NewService(testJWTSecret)
	e := echo.New()
	e.Use(proxyauth.NewMiddleware(db, authService, proxyauth.Config{
		SharedSecret:  testProxySecret,
		WorkspaceName: "OpenPost",
	}))
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handlers.NewAppBootstrapHandler(
		db,
		apimiddleware.NewJWTAuthenticator(authService),
		handlers.AccountPolicy{},
		nil,
	).RegisterRoutes(api)

	first := proxyOwnerRequest(t, e, "Rodrigo@example.com", testProxySecret)
	second := proxyOwnerRequest(t, e, "rodrigo@example.com", testProxySecret)
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	require.JSONEq(t, first.Body.String(), second.Body.String())
	var bootstrap struct {
		Authenticated       bool    `json:"authenticated"`
		SelectedWorkspaceID *string `json:"selected_workspace_id"`
	}
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &bootstrap))
	require.True(t, bootstrap.Authenticated)
	require.NotNil(t, bootstrap.SelectedWorkspaceID)

	var users []models.User
	require.NoError(t, db.NewSelect().Model(&users).Scan(t.Context()))
	require.Len(t, users, 1)
	require.Equal(t, "rodrigo@example.com", users[0].Email)
	require.Equal(t, "rodrigo", users[0].Username)
	require.Empty(t, users[0].PasswordHash)
	require.True(t, users[0].IsAdmin)
	require.False(t, users[0].EmailVerifiedAt.IsZero())

	var organizations []models.Organization
	require.NoError(t, db.NewSelect().Model(&organizations).Scan(t.Context()))
	require.Len(t, organizations, 1)
	require.Equal(t, users[0].ID, organizations[0].CreatedByID)

	var workspaces []models.Workspace
	require.NoError(t, db.NewSelect().Model(&workspaces).Scan(t.Context()))
	require.Len(t, workspaces, 1)
	require.Equal(t, "OpenPost", workspaces[0].Name)
	require.Equal(t, organizations[0].ID, workspaces[0].OrganizationID)

	var memberships []models.WorkspaceMember
	require.NoError(t, db.NewSelect().Model(&memberships).Scan(t.Context()))
	require.Equal(t, []models.WorkspaceMember{{
		WorkspaceID: workspaces[0].ID,
		UserID:      users[0].ID,
		Role:        models.WorkspaceRoleAdmin,
		Status:      models.WorkspaceMemberStatusActive,
	}}, stripWorkspaceMembershipTimes(memberships))

	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND scope_id = ?", "media_cleanup", workspaces[0].ID).
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, jobCount)
}

func TestMiddlewareLeavesRequestsAloneWithoutProxyCredentials(t *testing.T) {
	db := proxyAuthTestDB(t)
	e := echo.New()
	e.Use(proxyauth.NewMiddleware(db, auth.NewService(testJWTSecret), proxyauth.Config{
		SharedSecret: testProxySecret,
	}))
	e.GET("/public", func(c echo.Context) error {
		return c.String(http.StatusOK, c.Request().Header.Get(echo.HeaderAuthorization))
	})

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/public", nil)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Empty(t, response.Body.String())
	userCount, err := db.NewSelect().Model((*models.User)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, userCount)
}

func TestMiddlewareRejectsIncompleteOrInvalidProxyCredentials(t *testing.T) {
	tests := []struct {
		name   string
		user   string
		secret string
	}{
		{name: "missing secret", user: "owner@example.com"},
		{name: "missing user", secret: testProxySecret},
		{name: "wrong secret", user: "owner@example.com", secret: "wrong-secret"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := proxyAuthTestDB(t)
			e := echo.New()
			e.Use(proxyauth.NewMiddleware(db, auth.NewService(testJWTSecret), proxyauth.Config{
				SharedSecret: testProxySecret,
			}))
			e.GET("/private", func(c echo.Context) error {
				return c.NoContent(http.StatusNoContent)
			})

			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/private", nil)
			if test.user != "" {
				request.Header.Set(proxyauth.UserHeader, test.user)
			}
			if test.secret != "" {
				request.Header.Set(proxyauth.SecretHeader, test.secret)
			}
			response := httptest.NewRecorder()
			e.ServeHTTP(response, request)

			require.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())
			userCount, err := db.NewSelect().Model((*models.User)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, userCount)
		})
	}
}

func proxyAuthTestDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := database.InitDB("file:" + strings.ReplaceAll(t.Name(), "/", "-") + "?mode=memory&cache=shared")
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func proxyOwnerRequest(t *testing.T, e *echo.Echo, user, secret string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/app/bootstrap", nil)
	request.Header.Set(proxyauth.UserHeader, user)
	request.Header.Set(proxyauth.SecretHeader, secret)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	return response
}

func stripWorkspaceMembershipTimes(memberships []models.WorkspaceMember) []models.WorkspaceMember {
	for i := range memberships {
		memberships[i].CreatedAt = time.Time{}
		memberships[i].UpdatedAt = time.Time{}
	}
	return memberships
}
