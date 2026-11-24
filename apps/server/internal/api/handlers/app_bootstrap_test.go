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
		api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
		NewAppBootstrapHandler(
			db,
			appBootstrapErrorAuthenticator{err: context.DeadlineExceeded},
			AccountPolicy{},
			nil,
		).RegisterRoutes(api)

		response := getAppBootstrap(t, e, "valid-looking-token")

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
		api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
		NewAppBootstrapHandler(db, authenticator, AccountPolicy{}, nil).RegisterRoutes(api)

		invalid := getAppBootstrap(t, e, "op_cli_12345678_not-the-secret")
		require.Equal(t, http.StatusOK, invalid.Code, invalid.Body.String())
		require.False(t, decodeAppBootstrap(t, invalid).Body.Authenticated)

		require.NoError(t, db.Close())
		response := getAppBootstrap(t, e, generated.Token)

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
		api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
		NewAppBootstrapHandler(db, authenticator, AccountPolicy{}, nil).RegisterRoutes(api)
		response := getAppBootstrap(t, e, token)

		require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "authentication is temporarily unavailable")
	})
}

func getAppBootstrap(
	t *testing.T,
	e *echo.Echo,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/app/bootstrap", nil)
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
