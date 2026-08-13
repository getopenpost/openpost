package handlers

import (
	"encoding/json"
	"net/http"
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
	mcpActivitySSOWorkspaceID      = "mcp-activity-required-sso"
	mcpActivityPublicWorkspaceID   = "mcp-activity-public"
	mcpActivityInactiveWorkspaceID = "mcp-activity-inactive"
	mcpActivityOrganizationID      = "mcp-activity-organization"
	mcpActivityProviderID          = "mcp-activity-provider"
	mcpActivityUnboundTokenID      = "mcp-activity-unbound-token"
	mcpActivityBoundTokenID        = "mcp-activity-bound-token"
)

func TestListMCPActivityAllWorkspacesUsesCredentialAccessibleMemberships(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"unbound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: mcpActivityUnboundTokenID,
		},
		"bound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: mcpActivityBoundTokenID,
			WorkspaceID: mcpActivitySSOWorkspaceID,
		},
		"no-workspace-token": {
			UserID: "user-3", Email: "no-workspace@example.com",
			Scope: apitokens.ScopeCLI, TokenID: "mcp-activity-no-workspace-token",
		},
	}
	server := newMCPActivityCredentialAccessTestServer(t, authenticator)
	seedMCPActivityCredentialAccessFixture(t, server.db)

	unbound := server.getJSON(t, "/api/v1/mcp/activity", "unbound-token")
	require.Equal(t, http.StatusOK, unbound.Code, unbound.Body.String())
	require.Equal(t, []string{"call-public", "call-global"}, mcpActivityResponseIDs(t, unbound.Body.Bytes()))

	bound := server.getJSON(t, "/api/v1/mcp/activity", "bound-token")
	require.Equal(t, http.StatusOK, bound.Code, bound.Body.String())
	require.Equal(t, []string{"call-sso", "call-global"}, mcpActivityResponseIDs(t, bound.Body.Bytes()))

	noWorkspace := server.getJSON(t, "/api/v1/mcp/activity", "no-workspace-token")
	require.Equal(t, http.StatusOK, noWorkspace.Code, noWorkspace.Body.String())
	require.Equal(t, []string{"call-no-workspace"}, mcpActivityResponseIDs(t, noWorkspace.Body.Bytes()))

	unboundExplicit := server.getJSON(
		t,
		"/api/v1/mcp/activity?workspace_id="+mcpActivitySSOWorkspaceID,
		"unbound-token",
	)
	require.Equal(t, http.StatusForbidden, unboundExplicit.Code, unboundExplicit.Body.String())

	boundCrossWorkspace := server.getJSON(
		t,
		"/api/v1/mcp/activity?workspace_id="+mcpActivityPublicWorkspaceID,
		"bound-token",
	)
	require.Equal(t, http.StatusForbidden, boundCrossWorkspace.Code, boundCrossWorkspace.Body.String())
}

func newMCPActivityCredentialAccessTestServer(
	t *testing.T,
	authenticator workspaceTestAuthenticator,
) *mcpActivityTestServer {
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
		(*models.MCPToolCall)(nil),
	)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewMCPActivityHandler(db, authenticator).RegisterRoutes(api)
	return &mcpActivityTestServer{echo: e, db: db}
}

func seedMCPActivityCredentialAccessFixture(t *testing.T, db *bun.DB) {
	t.Helper()

	now := time.Now().UTC().Truncate(time.Second)
	rows := []any{
		&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"},
		&models.User{ID: "user-3", Email: "no-workspace@example.com", PasswordHash: "hash"},
		&models.Organization{
			ID: mcpActivityOrganizationID, Name: "MCP activity SSO", CreatedByID: "user-1", CreatedAt: now,
		},
		&models.Workspace{
			ID: mcpActivitySSOWorkspaceID, OrganizationID: mcpActivityOrganizationID,
			Name: "MCP activity SSO", CreatedAt: now,
		},
		&models.Workspace{ID: mcpActivityPublicWorkspaceID, Name: "MCP activity public", CreatedAt: now},
		&models.Workspace{ID: mcpActivityInactiveWorkspaceID, Name: "MCP activity inactive", CreatedAt: now},
		&models.WorkspaceMember{
			WorkspaceID: mcpActivitySSOWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: mcpActivityPublicWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: mcpActivityInactiveWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusInactive,
		},
		&models.IdentityProvider{
			ID: mcpActivityProviderID, OrganizationID: mcpActivityOrganizationID,
			Issuer: "https://idp.mcp-activity.example.test", Name: "MCP activity SSO",
			ClientID: "mcp-activity-client", IsActive: true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: mcpActivityOrganizationID, Mode: models.OrganizationSSOModeRequired,
			ProviderIDs:             `["` + mcpActivityProviderID + `"]`,
			AssuranceMaxAgeSeconds:  int((12 * time.Hour).Seconds()),
			APITokenMode:            models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.APIToken{
			ID: mcpActivityUnboundTokenID, UserID: "user-1", Name: "All workspaces",
			TokenHash: "mcp-activity-unbound-hash", TokenPrefix: "unbound", Scope: apitokens.ScopeCLI,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: mcpActivityBoundTokenID, UserID: "user-1", Name: "MCP activity SSO",
			TokenHash: "mcp-activity-bound-hash", TokenPrefix: "bound", Scope: apitokens.ScopeCLI,
			WorkspaceID: mcpActivitySSOWorkspaceID, OrganizationID: mcpActivityOrganizationID,
			IdentityProviderID: mcpActivityProviderID, AssuredAt: now, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: "mcp-activity-no-workspace-token", UserID: "user-3", Name: "No workspaces",
			TokenHash: "mcp-activity-no-workspace-hash", TokenPrefix: "none", Scope: apitokens.ScopeCLI,
			ExpiresAt: now.Add(24 * time.Hour),
		},
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	calls := []models.MCPToolCall{
		{ID: "call-public", UserID: "user-1", WorkspaceID: mcpActivityPublicWorkspaceID, ToolName: "list_posts", Status: "success", CreatedAt: now.Add(5 * time.Minute)},
		{ID: "call-sso", UserID: "user-1", WorkspaceID: mcpActivitySSOWorkspaceID, ToolName: "create_post", Status: "success", CreatedAt: now.Add(4 * time.Minute)},
		{ID: "call-inactive", UserID: "user-1", WorkspaceID: mcpActivityInactiveWorkspaceID, ToolName: "list_posts", Status: "success", CreatedAt: now.Add(3 * time.Minute)},
		{ID: "call-global", UserID: "user-1", ToolName: "list_workspaces", Status: "success", CreatedAt: now.Add(2 * time.Minute)},
		{ID: "call-other-user", UserID: "user-2", WorkspaceID: mcpActivityPublicWorkspaceID, ToolName: "list_posts", Status: "success", CreatedAt: now.Add(time.Minute)},
		{ID: "call-no-workspace", UserID: "user-3", ToolName: "list_workspaces", Status: "success", CreatedAt: now},
	}
	_, err := db.NewInsert().Model(&calls).Exec(t.Context())
	require.NoError(t, err)
}

func mcpActivityResponseIDs(t *testing.T, body []byte) []string {
	t.Helper()
	var items []MCPActivityItem
	require.NoError(t, json.Unmarshal(body, &items))
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}
