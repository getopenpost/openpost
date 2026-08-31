package handlers

import (
	"bytes"
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
	"github.com/openpost/backend/internal/services/aiprompts"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
)

func TestInstanceAdministratorCanEditAndRestorePostGenerationPrompts(t *testing.T) {
	e := newAIPromptTestServer(t, true, browserSessionTestAuthenticator())

	listed := requestAIPrompts(t, e, http.MethodGet, "/api/v1/admin/ai-prompts", nil)
	require.Equal(t, http.StatusOK, listed.Code, listed.Body.String())
	var catalogue AIPromptsResponse
	require.NoError(t, json.Unmarshal(listed.Body.Bytes(), &catalogue))
	require.Len(t, catalogue.Prompts, 10)
	require.NotEmpty(t, catalogue.FixedOutputContract)

	custom := "Write a compact technical update with no launch language."
	saved := requestAIPrompts(t, e, http.MethodPut, "/api/v1/admin/ai-prompts/post.platform.x", map[string]string{"value": custom})
	require.Equal(t, http.StatusOK, saved.Code, saved.Body.String())
	var prompt AIPromptResponse
	require.NoError(t, json.Unmarshal(saved.Body.Bytes(), &prompt))
	require.True(t, prompt.Overridden)
	require.Equal(t, custom, prompt.Value)
	require.Equal(t, "Instance Admin", prompt.UpdatedBy)

	reset := requestAIPrompts(t, e, http.MethodPut, "/api/v1/admin/ai-prompts/post.platform.x", map[string]string{"value": prompt.DefaultValue})
	require.Equal(t, http.StatusOK, reset.Code, reset.Body.String())
	require.NoError(t, json.Unmarshal(reset.Body.Bytes(), &prompt))
	require.False(t, prompt.Overridden)
	require.Equal(t, prompt.DefaultValue, prompt.Value)
}

func TestInstanceAIPromptsRequireAdministratorBrowserSession(t *testing.T) {
	tests := []struct {
		name          string
		isAdmin       bool
		authenticator middleware.Authenticator
		message       string
	}{
		{name: "ordinary user", isAdmin: false, authenticator: browserSessionTestAuthenticator(), message: "instance admin role required"},
		{name: "API token", isAdmin: true, authenticator: unboundCLIFullTestAuthenticator(), message: "browser session"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			e := newAIPromptTestServer(t, test.isAdmin, test.authenticator)
			response := requestAIPrompts(t, e, http.MethodGet, "/api/v1/admin/ai-prompts", nil)
			require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
			require.Contains(t, response.Body.String(), test.message)
		})
	}
}

func newAIPromptTestServer(t *testing.T, isAdmin bool, authenticator middleware.Authenticator) *echo.Echo {
	t.Helper()
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.AIPromptOverride)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "admin@example.com", DisplayName: "Instance Admin", PasswordHash: "hash", IsAdmin: isAdmin, CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	service := aiprompts.NewService(db, servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"))
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAIPromptHandler(service, db, authenticator).RegisterRoutes(api)
	return e
}

func requestAIPrompts(t *testing.T, e *echo.Echo, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	request := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	request.Header.Set("Authorization", "Bearer web-token")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	e.ServeHTTP(recorder, request)
	return recorder
}
