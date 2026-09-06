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
	authservice "github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
)

func TestAppBootstrapReturnsExplicitAnonymousState(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAppBootstrapHandler(db, workspaceTestAuthenticator{
		"stale-token": {UserID: "missing-user", Email: "missing@example.com", SessionID: "stale-session"},
	}, AccountPolicy{}, nil).RegisterRoutes(api)

	for _, token := range []string{"", "invalid-token", "stale-token"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/app/bootstrap", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		e.ServeHTTP(response, req)

		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var body map[string]any
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Equal(t, false, body["authenticated"])
		require.Contains(t, body, "user")
		require.Nil(t, body["user"])
		require.Equal(t, []any{}, body["workspaces"])
		require.Contains(t, body, "selected_workspace_id")
		require.Nil(t, body["selected_workspace_id"])
		require.Contains(t, body, "selected_workspace_settings")
		require.Nil(t, body["selected_workspace_settings"])
	}
}

type appBootstrapErrorAuthenticator struct {
	err error
}

func (a appBootstrapErrorAuthenticator) AuthenticateBearer(context.Context, string) (*middleware.Principal, error) {
	return nil, a.err
}

func TestAppBootstrapFailsClosedWhenAuthenticationIsUnavailable(t *testing.T) {
	t.Parallel()

	t.Run("generic authentication error", func(t *testing.T) {
		t.Parallel()

		db := createHandlerTestDB(t, (*models.User)(nil))
		e := echo.New()
		api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
		NewAppBootstrapHandler(
			db,
			appBootstrapErrorAuthenticator{err: context.DeadlineExceeded},
			AccountPolicy{},
			nil,
		).RegisterRoutes(api)

		response := getAppBootstrap(t, e, "/api/v1/app/bootstrap", "valid-looking-token")

		require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "authentication is temporarily unavailable")
	})

	t.Run("token validation without database", func(t *testing.T) {
		t.Parallel()

		db := createHandlerTestDB(t, (*models.User)(nil), (*models.APIToken)(nil))
		user := &models.User{ID: "api-token-user", Email: "api-token@example.com", CreatedAt: time.Now().UTC()}
		_, err := db.NewInsert().Model(user).Exec(t.Context())
		require.NoError(t, err)
		tokenService := apitokens.NewService(db)
		generated, err := tokenService.GenerateToken(t.Context(), user.ID, "Bootstrap", apitokens.ScopeCLI, nil)
		require.NoError(t, err)
		authenticator := middleware.NewCompositeServiceWithSessions(
			authservice.NewService("bootstrap-test-secret"),
			tokenService,
			nil,
		)
		e := echo.New()
		api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
		NewAppBootstrapHandler(db, authenticator, AccountPolicy{}, nil).RegisterRoutes(api)

		invalid := getAppBootstrap(t, e, "/api/v1/app/bootstrap", "op_cli_12345678_not-the-secret")
		require.Equal(t, http.StatusOK, invalid.Code, invalid.Body.String())
		require.False(t, decodeAppBootstrap(t, invalid).Body.Authenticated)

		require.NoError(t, db.Close())
		response := getAppBootstrap(t, e, "/api/v1/app/bootstrap", generated.Token)

		require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "authentication is temporarily unavailable")
	})

	t.Run("session validation without database", func(t *testing.T) {
		t.Parallel()

		db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
		user := &models.User{ID: "session-user", Email: "session@example.com", CreatedAt: time.Now().UTC()}
		_, err := db.NewInsert().Model(user).Exec(t.Context())
		require.NoError(t, err)
		sessionService := sessions.NewService(db)
		session, err := sessionService.CreateSession(t.Context(), sessions.CreateInput{
			UserID:    user.ID,
			ExpiresAt: time.Now().UTC().Add(time.Hour),
		})
		require.NoError(t, err)
		authService := authservice.NewService("bootstrap-test-secret")
		token, err := authService.GenerateTokenWithSession(user.ID, user.Email, session.ID, session.ExpiresAt)
		require.NoError(t, err)
		authenticator := middleware.NewCompositeServiceWithSessions(authService, nil, sessionService)
		require.NoError(t, db.Close())

		e := echo.New()
		api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
		NewAppBootstrapHandler(db, authenticator, AccountPolicy{}, nil).RegisterRoutes(api)
		response := getAppBootstrap(t, e, "/api/v1/app/bootstrap", token)

		require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "authentication is temporarily unavailable")
	})
}

func TestAppBootstrapReturnsAuthenticatedStateWithoutAWorkspace(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
	)
	user := &models.User{
		ID: "user-without-workspaces", Email: "solo@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAppBootstrapHandler(db, workspaceTestAuthenticator{
		"valid-token": {UserID: user.ID, Email: user.Email, SessionID: "session-1"},
	}, AccountPolicy{}, nil).RegisterRoutes(api)
	response := getAppBootstrap(t, e, "/api/v1/app/bootstrap", "valid-token")

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body map[string]any
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Equal(t, true, body["authenticated"])
	require.NotNil(t, body["user"])
	require.Equal(t, []any{}, body["workspaces"])
	require.Contains(t, body, "selected_workspace_id")
	require.Nil(t, body["selected_workspace_id"])
	require.Contains(t, body, "selected_workspace_settings")
	require.Nil(t, body["selected_workspace_settings"])
}

func TestAppBootstrapReturnsPreferredWorkspaceAndSettings(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.SessionIdentityAssurance)(nil),
		(*models.UserIdentity)(nil),
		(*models.APIToken)(nil),
	)
	now := time.Now().UTC().Truncate(time.Second)
	user := &models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: now,
	}
	workspaces := []models.Workspace{
		{ID: "workspace-beta", Name: "Beta", Timezone: "Europe/Lisbon", WeekStart: 1, RandomDelayMinutes: 7, SlotStartHour: 8, SlotEndHour: 20, SlotIntervalMinutes: 30, CreatedAt: now},
		{ID: "workspace-alpha", Name: "Alpha", Timezone: "UTC", WeekStart: 0, SlotStartHour: 5, SlotEndHour: 23, SlotIntervalMinutes: 15, CreatedAt: now},
	}
	members := []models.WorkspaceMember{
		{WorkspaceID: "workspace-alpha", UserID: user.ID, Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: "workspace-beta", UserID: user.ID, Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive},
	}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&workspaces).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)

	authenticator := workspaceTestAuthenticator{
		"valid-token": middleware.Principal{UserID: user.ID, Email: user.Email, SessionID: "session-1"},
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAppBootstrapHandler(db, authenticator, AccountPolicy{}, nil).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/api/v1/app/bootstrap?preferred_workspace_id=workspace-beta",
		nil,
	)
	req.Header.Set("Authorization", "Bearer valid-token")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, req)

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output AppBootstrapOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.True(t, output.Body.Authenticated)
	require.NotNil(t, output.Body.User)
	require.Equal(t, user.ID, output.Body.User.ID)
	require.Equal(t, []string{"workspace-alpha", "workspace-beta"}, []string{
		output.Body.Workspaces[0].WorkspaceID,
		output.Body.Workspaces[1].WorkspaceID,
	})
	require.NotNil(t, output.Body.SelectedWorkspaceID)
	require.Equal(t, "workspace-beta", *output.Body.SelectedWorkspaceID)
	require.NotNil(t, output.Body.SelectedWorkspaceSettings)
	require.Equal(t, "Beta", output.Body.SelectedWorkspaceSettings.Name)
	require.Equal(t, "Europe/Lisbon", output.Body.SelectedWorkspaceSettings.Timezone)
	require.Equal(t, 7, output.Body.SelectedWorkspaceSettings.RandomDelayMinutes)
	require.Equal(t, 30, output.Body.SelectedWorkspaceSettings.SlotIntervalMinutes)
}

func TestAppBootstrapPreservesSSOAndWorkspaceTokenBoundaries(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.WorkspaceInvitation)(nil),
		(*models.WorkspaceInvitationResend)(nil),
		(*models.WorkspaceAccessAuditEvent)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.SessionIdentityAssurance)(nil),
		(*models.UserIdentity)(nil),
		(*models.APIToken)(nil),
	)
	seedWorkspaceCredentialAccessFixture(t, db)
	authenticator := workspaceTestAuthenticator{
		"browser-token": {
			UserID: workspaceCredentialAdminUserID, Email: "admin@example.com", SessionID: "browser-session",
		},
		"unbound-token": {
			UserID: workspaceCredentialAdminUserID, Email: "admin@example.com",
			Scope: apitokens.ScopeCLI, TokenID: workspaceCredentialUnboundToken,
		},
		"bound-token": {
			UserID: workspaceCredentialAdminUserID, Email: "admin@example.com",
			Scope: apitokens.ScopeCLI, TokenID: workspaceCredentialBoundToken,
			WorkspaceID: workspaceCredentialTestID,
		},
		"api-read-token": {
			UserID: workspaceCredentialAdminUserID, Email: "admin@example.com",
			Scope: apitokens.ScopeAPIRead, TokenID: workspaceCredentialUnboundToken,
		},
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAppBootstrapHandler(db, authenticator, AccountPolicy{}, nil).RegisterRoutes(api)

	t.Run("browser discovers required SSO but receives no protected settings", func(t *testing.T) {
		response := getAppBootstrap(
			t,
			e,
			"/api/v1/app/bootstrap?preferred_workspace_id="+workspaceCredentialTestID,
			"browser-token",
		)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		output := decodeAppBootstrap(t, response)
		require.True(t, output.Body.Authenticated)
		require.ElementsMatch(t, []string{workspaceCredentialPublicID, workspaceCredentialTestID}, appBootstrapWorkspaceIDs(output))
		require.Equal(t, workspaceCredentialTestID, *output.Body.SelectedWorkspaceID)
		require.Nil(t, output.Body.SelectedWorkspaceSettings)
		selected := appBootstrapWorkspace(output, workspaceCredentialTestID)
		require.True(t, selected.SSORequired)
		require.False(t, selected.SSOAuthenticated)
	})

	t.Run("unbound CLI token sees only workspaces allowed by SSO", func(t *testing.T) {
		response := getAppBootstrap(
			t,
			e,
			"/api/v1/app/bootstrap?preferred_workspace_id="+workspaceCredentialTestID,
			"unbound-token",
		)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		output := decodeAppBootstrap(t, response)
		require.True(t, output.Body.Authenticated)
		require.Equal(t, []string{workspaceCredentialPublicID}, appBootstrapWorkspaceIDs(output))
		require.Equal(t, workspaceCredentialPublicID, *output.Body.SelectedWorkspaceID)
		require.NotNil(t, output.Body.SelectedWorkspaceSettings)
	})

	t.Run("bound CLI token selects only its assured workspace", func(t *testing.T) {
		response := getAppBootstrap(
			t,
			e,
			"/api/v1/app/bootstrap?preferred_workspace_id="+workspaceCredentialPublicID,
			"bound-token",
		)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		output := decodeAppBootstrap(t, response)
		require.True(t, output.Body.Authenticated)
		require.Equal(t, []string{workspaceCredentialTestID}, appBootstrapWorkspaceIDs(output))
		require.Equal(t, workspaceCredentialTestID, *output.Body.SelectedWorkspaceID)
		require.NotNil(t, output.Body.SelectedWorkspaceSettings)
	})

	t.Run("narrow REST token does not gain account identity access", func(t *testing.T) {
		response := getAppBootstrap(t, e, "/api/v1/app/bootstrap", "api-read-token")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		output := decodeAppBootstrap(t, response)
		require.False(t, output.Body.Authenticated)
		require.Nil(t, output.Body.User)
		require.Empty(t, output.Body.Workspaces)
		require.Nil(t, output.Body.SelectedWorkspaceID)
		require.Nil(t, output.Body.SelectedWorkspaceSettings)
	})
}

func getAppBootstrap(
	t *testing.T,
	e *echo.Echo,
	path string,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	e.ServeHTTP(response, req)
	return response
}

func decodeAppBootstrap(t *testing.T, response *httptest.ResponseRecorder) AppBootstrapOutput {
	t.Helper()
	var output AppBootstrapOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	return output
}

func appBootstrapWorkspaceIDs(output AppBootstrapOutput) []string {
	ids := make([]string, 0, len(output.Body.Workspaces))
	for _, workspace := range output.Body.Workspaces {
		ids = append(ids, workspace.WorkspaceID)
	}
	return ids
}

func appBootstrapWorkspace(output AppBootstrapOutput, workspaceID string) WorkspaceResponse {
	for _, workspace := range output.Body.Workspaces {
		if workspace.WorkspaceID == workspaceID {
			return workspace
		}
	}
	return WorkspaceResponse{}
}
