package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	promptCredentialSSOWorkspaceID      = "prompt-required-sso"
	promptCredentialPublicWorkspaceID   = "prompt-public"
	promptCredentialInactiveWorkspaceID = "prompt-inactive"
	promptCredentialOrganizationID      = "prompt-organization"
	promptCredentialProviderID          = "prompt-provider"
	promptCredentialUnboundTokenID      = "prompt-unbound-token"
	promptCredentialBoundTokenID        = "prompt-bound-token"
)

type promptCredentialTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func TestPromptReadsFilterCredentialAccessibleActiveMemberships(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"unbound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: promptCredentialUnboundTokenID,
		},
		"bound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: promptCredentialBoundTokenID,
			WorkspaceID: promptCredentialSSOWorkspaceID,
		},
	}
	server := newPromptCredentialTestServer(t, authenticator)
	seedPromptCredentialFixture(t, server.db)

	list := server.get(t, "/api/v1/prompts", "unbound-token")
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	var prompts []PromptResponse
	require.NoError(t, json.Unmarshal(list.Body.Bytes(), &prompts))
	promptIDs := make(map[string]bool, len(prompts))
	for _, prompt := range prompts {
		promptIDs[prompt.ID] = true
	}
	require.True(t, promptIDs["builtin-001"])
	require.True(t, promptIDs["prompt-personal"])
	require.False(t, promptIDs["prompt-public"])
	require.False(t, promptIDs["prompt-sso"])
	require.False(t, promptIDs["prompt-inactive"])

	random := server.get(t, "/api/v1/prompts/random?category=credential-random", "unbound-token")
	require.Equal(t, http.StatusOK, random.Code, random.Body.String())
	var randomPrompt PromptResponse
	require.NoError(t, json.Unmarshal(random.Body.Bytes(), &randomPrompt))
	require.Equal(t, "prompt-personal", randomPrompt.ID)

	boundImplicit := server.get(t, "/api/v1/prompts/random?category=credential-random", "bound-token")
	require.Equal(t, http.StatusOK, boundImplicit.Code, boundImplicit.Body.String())
	require.NoError(t, json.Unmarshal(boundImplicit.Body.Bytes(), &randomPrompt))
	require.Equal(t, "prompt-sso", randomPrompt.ID)

	boundExplicit := server.get(
		t,
		"/api/v1/prompts/random?workspace_id="+promptCredentialSSOWorkspaceID+"&category=credential-random",
		"bound-token",
	)
	require.Equal(t, http.StatusOK, boundExplicit.Code, boundExplicit.Body.String())
	require.NoError(t, json.Unmarshal(boundExplicit.Body.Bytes(), &randomPrompt))
	require.Equal(t, "prompt-sso", randomPrompt.ID)

	unboundExplicit := server.get(
		t,
		"/api/v1/prompts?workspace_id="+promptCredentialSSOWorkspaceID,
		"unbound-token",
	)
	require.Equal(t, http.StatusForbidden, unboundExplicit.Code, unboundExplicit.Body.String())
}

func newPromptCredentialTestServer(
	t *testing.T,
	authenticator workspaceTestAuthenticator,
) *promptCredentialTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.APIToken)(nil),
		(*models.Prompt)(nil),
	)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewPromptHandler(db, authenticator)
	handler.ListPrompts(api)
	handler.GetRandomPrompt(api)
	return &promptCredentialTestServer{echo: e, db: db}
}

func (server *promptCredentialTestServer) get(
	t *testing.T,
	path,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, req)
	return response
}

func seedPromptCredentialFixture(t *testing.T, db *bun.DB) {
	t.Helper()

	now := time.Now().UTC().Truncate(time.Second)
	rows := []any{
		&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"},
		&models.Organization{
			ID: promptCredentialOrganizationID, Name: "Prompt SSO", CreatedByID: "user-1", CreatedAt: now,
		},
		&models.Workspace{
			ID: promptCredentialSSOWorkspaceID, OrganizationID: promptCredentialOrganizationID,
			Name: "Prompt SSO", CreatedAt: now,
		},
		&models.Workspace{ID: promptCredentialPublicWorkspaceID, Name: "Prompt public", CreatedAt: now},
		&models.Workspace{ID: promptCredentialInactiveWorkspaceID, Name: "Prompt inactive", CreatedAt: now},
		&models.WorkspaceMember{
			WorkspaceID: promptCredentialSSOWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: promptCredentialPublicWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: promptCredentialInactiveWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusInactive,
		},
		&models.IdentityProvider{
			ID: promptCredentialProviderID, OrganizationID: promptCredentialOrganizationID,
			Issuer: "https://idp.prompt-handler.example.test", Name: "Prompt handler SSO",
			ClientID: "prompt-handler-client", IsActive: true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: promptCredentialOrganizationID, Mode: models.OrganizationSSOModeRequired,
			ProviderIDs:             `["` + promptCredentialProviderID + `"]`,
			AssuranceMaxAgeSeconds:  int((12 * time.Hour).Seconds()),
			APITokenMode:            models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.APIToken{
			ID: promptCredentialUnboundTokenID, UserID: "user-1", Name: "All workspaces",
			TokenHash: "prompt-unbound-hash", TokenPrefix: "unbound", Scope: apitokens.ScopeCLI,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: promptCredentialBoundTokenID, UserID: "user-1", Name: "Prompt SSO",
			TokenHash: "prompt-bound-hash", TokenPrefix: "bound", Scope: apitokens.ScopeCLI,
			WorkspaceID: promptCredentialSSOWorkspaceID, OrganizationID: promptCredentialOrganizationID,
			IdentityProviderID: promptCredentialProviderID, AssuredAt: now, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.Prompt{
			ID: "prompt-personal", UserID: "user-1", Text: "Personal", Category: "credential-random", CreatedAt: now,
		},
		&models.Prompt{
			ID: "prompt-public", WorkspaceID: promptCredentialPublicWorkspaceID, UserID: "user-2",
			Text: "Public", Category: "credential-random", CreatedAt: now,
		},
		&models.Prompt{
			ID: "prompt-sso", WorkspaceID: promptCredentialSSOWorkspaceID, UserID: "user-1",
			Text: "Required SSO", Category: "credential-random", CreatedAt: now,
		},
		&models.Prompt{
			ID: "prompt-inactive", WorkspaceID: promptCredentialInactiveWorkspaceID, UserID: "user-1",
			Text: "Inactive", Category: "credential-random", CreatedAt: now,
		},
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
}
