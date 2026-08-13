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
	"github.com/openpost/backend/internal/services/updatestatus"
	"github.com/stretchr/testify/require"
)

func TestUpdateStatusRequiresInstanceAdmin(t *testing.T) {
	t.Parallel()

	e := newUpdateStatusTestServer(t, false, browserSessionTestAuthenticator())
	resp := updateStatusRequest(t, e, "web-token")

	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "instance admin role required")
}

func TestUpdateStatusRejectsWorkspaceScopedCredentials(t *testing.T) {
	t.Parallel()

	e := newUpdateStatusTestServer(t, true, workspaceTestAuthenticator{
		"scoped-token": {
			UserID: "user-1", Email: "user@example.com", WorkspaceID: "ws-1", SessionID: "browser-session",
		},
	})
	resp := updateStatusRequest(t, e, "scoped-token")

	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "unscoped credentials")
}

func TestUpdateStatusReturnsReadOnlyDisabledState(t *testing.T) {
	t.Parallel()

	e := newUpdateStatusTestServer(t, true, browserSessionTestAuthenticator())
	resp := updateStatusRequest(t, e, "web-token")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var body UpdateStatusResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Equal(t, updatestatus.StateDisabled, body.State)
	require.Equal(t, "v1.2.3", body.RunningVersion)
	require.Equal(t, "abc123", body.RunningBuild)
	require.Empty(t, body.ReleaseURL)
	require.False(t, body.EffectiveEnabled)
	require.False(t, body.ConfiguredEnabled)
	require.Equal(t, "default", body.ConfigurationSource)
}

func TestUpdateStatusRejectsBearerAdminToken(t *testing.T) {
	t.Parallel()

	e := newUpdateStatusTestServer(t, true, unboundCLIFullTestAuthenticator())
	resp := updateStatusRequest(t, e, "web-token")

	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "browser session")
}

func newUpdateStatusTestServer(t *testing.T, isAdmin bool, authenticator middleware.Authenticator) *echo.Echo {
	t.Helper()

	db := createHandlerTestDB(t, (*models.User)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		IsAdmin:      isAdmin,
		CreatedAt:    time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	service := updatestatus.NewService(updatestatus.Options{
		Enabled:        false,
		RunningVersion: "v1.2.3",
		RunningBuild:   "abc123",
	})
	NewUpdateStatusHandler(db, authenticator, service, nil).RegisterRoutes(api)
	return e
}

func updateStatusRequest(t *testing.T, e *echo.Echo, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/admin/update-status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
