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
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	workspaceCredentialTestID           = "workspace-required-sso"
	workspaceCredentialPublicID         = "workspace-public"
	workspaceCredentialOrgID            = "organization-required-sso"
	workspaceCredentialPublicOrgID      = "organization-public"
	workspaceCredentialProviderID       = "provider-required-sso"
	workspaceCredentialUnboundToken     = "workspace-unbound-token"
	workspaceCredentialBoundToken       = "workspace-bound-token"
	workspaceCredentialAdminUserID      = "workspace-admin"
	workspaceCredentialMemberUserID     = "workspace-member"
	workspaceCredentialInviteeUserID    = "workspace-invitee"
	workspaceCredentialInviteeTokenID   = "workspace-invitee-unbound-token"
	workspaceCredentialInviteeSessionID = "workspace-invitee-browser-session"
	workspaceCredentialInvitationID     = "workspace-invitation"
)

func TestWorkspaceTeamHandlersRequireCredentialAccessibleWorkspace(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"unbound-token": {
			UserID: workspaceCredentialAdminUserID, Email: "admin@example.com",
			Scope: apitokens.ScopeCLI, TokenID: workspaceCredentialUnboundToken,
		},
		"bound-token": {
			UserID: workspaceCredentialAdminUserID, Email: "admin@example.com",
			Scope: apitokens.ScopeCLI, TokenID: workspaceCredentialBoundToken,
			WorkspaceID: workspaceCredentialTestID,
		},
	}
	server := newWorkspaceCredentialAccessTestServer(t, authenticator)
	seedWorkspaceCredentialAccessFixture(t, server.db)

	denied := []*workspaceCredentialRequest{
		{method: http.MethodGet, path: "/api/v1/workspaces/" + workspaceCredentialTestID + "/team"},
		{method: http.MethodPost, path: "/api/v1/workspaces/" + workspaceCredentialTestID + "/invitations", body: map[string]string{
			"email": "blocked@example.com", "role": models.WorkspaceRoleViewer,
		}},
		{method: http.MethodPost, path: "/api/v1/workspaces/" + workspaceCredentialTestID + "/invitations/" + workspaceCredentialInvitationID + "/resend", body: map[string]string{}},
		{method: http.MethodDelete, path: "/api/v1/workspaces/" + workspaceCredentialTestID + "/invitations/" + workspaceCredentialInvitationID},
		{method: http.MethodPatch, path: "/api/v1/workspaces/" + workspaceCredentialTestID + "/members/" + workspaceCredentialMemberUserID, body: map[string]string{
			"role": models.WorkspaceRoleViewer,
		}},
		{method: http.MethodDelete, path: "/api/v1/workspaces/" + workspaceCredentialTestID + "/members/" + workspaceCredentialMemberUserID},
		{method: http.MethodGet, path: "/api/v1/workspaces/" + workspaceCredentialTestID + "/access-audit"},
	}
	for _, request := range denied {
		response := request.send(t, server, "unbound-token")
		require.Equal(t, http.StatusForbidden, response.Code, "%s %s: %s", request.method, request.path, response.Body.String())
	}

	var invitation models.WorkspaceInvitation
	require.NoError(t, server.db.NewSelect().Model(&invitation).
		Where("id = ?", workspaceCredentialInvitationID).Scan(t.Context()))
	require.Equal(t, "unchanged-token-hash", invitation.TokenHash)
	require.True(t, invitation.RevokedAt.IsZero())
	var member models.WorkspaceMember
	require.NoError(t, server.db.NewSelect().Model(&member).
		Where("workspace_id = ? AND user_id = ?", workspaceCredentialTestID, workspaceCredentialMemberUserID).
		Scan(t.Context()))
	require.Equal(t, models.WorkspaceRoleEditor, member.Role)

	team := server.getJSON(t, "/api/v1/workspaces/"+workspaceCredentialTestID+"/team", "bound-token")
	require.Equal(t, http.StatusOK, team.Code, team.Body.String())
	audit := server.getJSON(t, "/api/v1/workspaces/"+workspaceCredentialTestID+"/access-audit", "bound-token")
	require.Equal(t, http.StatusOK, audit.Code, audit.Body.String())
	created := server.postJSON(t, "/api/v1/workspaces/"+workspaceCredentialTestID+"/invitations", map[string]string{
		"email": "allowed@example.com", "role": models.WorkspaceRoleViewer,
	}, "bound-token")
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
}

func TestListOrganizationsRejectsWorkspaceBoundCredential(t *testing.T) {
	t.Parallel()

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
	}
	server := newWorkspaceCredentialAccessTestServer(t, authenticator)
	seedWorkspaceCredentialAccessFixture(t, server.db)

	for _, token := range []string{"browser-token", "unbound-token"} {
		response := server.getJSON(t, "/api/v1/organizations", token)
		require.Equal(t, http.StatusOK, response.Code, "%s: %s", token, response.Body.String())
		var organizations []OrganizationResponse
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &organizations))
		organizationIDs := make([]string, 0, len(organizations))
		for _, organization := range organizations {
			organizationIDs = append(organizationIDs, organization.ID)
		}
		if token == "browser-token" {
			require.ElementsMatch(t, []string{workspaceCredentialOrgID, workspaceCredentialPublicOrgID}, organizationIDs)
		} else {
			require.Equal(t, []string{workspaceCredentialPublicOrgID}, organizationIDs)
		}
	}

	bound := server.getJSON(t, "/api/v1/organizations", "bound-token")
	require.Equal(t, http.StatusForbidden, bound.Code, bound.Body.String())
	require.Contains(t, bound.Body.String(), "workspace-bound tokens cannot access organization-level resources")
}

func TestAcceptWorkspaceInvitationRequiresCredentialSSOAccess(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"invitee-unbound-token": {
			UserID: workspaceCredentialInviteeUserID, Email: "invited@example.com",
			Scope: apitokens.ScopeCLI, TokenID: workspaceCredentialInviteeTokenID,
		},
		"invitee-browser-token": {
			UserID: workspaceCredentialInviteeUserID, Email: "invited@example.com",
			SessionID: workspaceCredentialInviteeSessionID,
		},
	}
	server := newWorkspaceCredentialAccessTestServer(t, authenticator)
	seedWorkspaceCredentialAccessFixture(t, server.db)

	path := "/api/v1/workspace-invitations/" + workspaceCredentialInvitationID + "/accept"
	denied := server.postJSON(t, path, map[string]string{}, "invitee-unbound-token")
	require.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())

	var invitation models.WorkspaceInvitation
	require.NoError(t, server.db.NewSelect().Model(&invitation).
		Where("id = ?", workspaceCredentialInvitationID).Scan(t.Context()))
	require.True(t, invitation.AcceptedAt.IsZero())
	membershipCount, err := server.db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ?", workspaceCredentialTestID, workspaceCredentialInviteeUserID).
		Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, membershipCount)

	accepted := server.postJSON(t, path, map[string]string{}, "invitee-browser-token")
	require.Equal(t, http.StatusOK, accepted.Code, accepted.Body.String())
	require.NoError(t, server.db.NewSelect().Model(&invitation).
		Where("id = ?", workspaceCredentialInvitationID).Scan(t.Context()))
	require.False(t, invitation.AcceptedAt.IsZero())
	membershipCount, err = server.db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ?", workspaceCredentialTestID, workspaceCredentialInviteeUserID).
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, membershipCount)
}

func TestListWorkspacesFiltersTokenDeniedRowsButKeepsBrowserDiscovery(t *testing.T) {
	t.Parallel()

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
	}
	server := newWorkspaceCredentialAccessTestServer(t, authenticator)
	seedWorkspaceCredentialAccessFixture(t, server.db)

	browser := server.getJSON(t, "/api/v1/workspaces", "browser-token")
	require.Equal(t, http.StatusOK, browser.Code, browser.Body.String())
	browserWorkspaces := workspaceResponseIDsFromBody(t, browser.Body.Bytes())
	require.ElementsMatch(t, []string{workspaceCredentialTestID, workspaceCredentialPublicID}, browserWorkspaces)

	unbound := server.getJSON(t, "/api/v1/workspaces", "unbound-token")
	require.Equal(t, http.StatusOK, unbound.Code, unbound.Body.String())
	require.Equal(t, []string{workspaceCredentialPublicID}, workspaceResponseIDsFromBody(t, unbound.Body.Bytes()))

	bound := server.getJSON(t, "/api/v1/workspaces", "bound-token")
	require.Equal(t, http.StatusOK, bound.Code, bound.Body.String())
	require.Equal(t, []string{workspaceCredentialTestID}, workspaceResponseIDsFromBody(t, bound.Body.Bytes()))
}

func TestCreateWorkspaceRechecksPreferredOrganizationCredentialAccess(t *testing.T) {
	t.Parallel()

	const (
		userID     = "preferred-organization-owner"
		orgID      = "preferred-required-sso-organization"
		providerID = "preferred-organization-provider"
		sessionID  = "preferred-organization-browser-session"
		tokenID    = "preferred-organization-unbound-token"
	)
	authenticator := workspaceTestAuthenticator{
		"browser-token": {
			UserID: userID, Email: "owner@example.com", SessionID: sessionID,
		},
		"unbound-token": {
			UserID: userID, Email: "owner@example.com", Scope: apitokens.ScopeCLI, TokenID: tokenID,
		},
	}
	server := newWorkspaceTestServerWithAuthenticator(t, entitlements.NewSelfHostedService(), authenticator)
	now := time.Now().UTC().Truncate(time.Second)
	rows := []any{
		&models.User{ID: userID, Email: "owner@example.com", PasswordHash: "hash", CreatedAt: now},
		&models.Organization{ID: orgID, Name: "Protected", CreatedByID: userID, CreatedAt: now},
		&models.OrganizationMember{
			OrganizationID: orgID, UserID: userID, Role: models.OrganizationRoleOwner, CreatedAt: now,
		},
		&models.BillingSubscription{
			OrganizationID: orgID, Provider: models.BillingProviderPaddle,
			ProviderCustomerID: "customer", ProviderSubscriptionID: "subscription",
			Status: "active", CreatedAt: now, UpdatedAt: now,
		},
		&models.IdentityProvider{
			ID: providerID, OrganizationID: orgID, Issuer: "https://preferred.example.test",
			Name: "Preferred SSO", ClientID: "preferred-client", IsActive: true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: orgID, Mode: models.OrganizationSSOModeRequired,
			ProviderIDs: `["` + providerID + `"]`, AssuranceMaxAgeSeconds: int((12 * time.Hour).Seconds()),
			APITokenMode: models.OrganizationSSOTokensScoped, MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.SessionIdentityAssurance{
			SessionID: sessionID, ProviderID: providerID, UserID: userID,
			AuthTime: now, ExpiresAt: now.Add(12 * time.Hour), CreatedAt: now,
		},
		&models.APIToken{
			ID: tokenID, UserID: userID, Name: "Unbound", TokenHash: "unbound-hash",
			TokenPrefix: "unbound", Scope: apitokens.ScopeCLI, ExpiresAt: now.Add(24 * time.Hour),
		},
	}
	for _, row := range rows {
		_, err := server.db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	denied := server.postJSON(t, "/api/v1/workspaces", map[string]string{"name": "Denied"}, "unbound-token")
	require.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())

	allowed := server.postJSON(t, "/api/v1/workspaces", map[string]string{"name": "Allowed"}, "browser-token")
	require.Equal(t, http.StatusOK, allowed.Code, allowed.Body.String())
	var output CreateWorkspaceOutput
	require.NoError(t, json.Unmarshal(allowed.Body.Bytes(), &output.Body))
	require.Equal(t, orgID, output.Body.OrganizationID)

	workspaceCount, err := server.db.NewSelect().Model((*models.Workspace)(nil)).
		Where("organization_id = ?", orgID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, workspaceCount)
}

func TestCredentialFilteredReadOperationsDeclareAuthorizationErrors(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.Prompt)(nil))
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewWorkspaceHandler(db, testAuthenticator{}).ListOrganizations(api)
	promptHandler := NewPromptHandler(db, testAuthenticator{})
	promptHandler.ListPrompts(api)
	promptHandler.GetRandomPrompt(api)

	raw, err := json.Marshal(api.OpenAPI())
	require.NoError(t, err)
	var document struct {
		Paths map[string]map[string]struct {
			OperationID string                     `json:"operationId"`
			Responses   map[string]json.RawMessage `json:"responses"`
		} `json:"paths"`
	}
	require.NoError(t, json.Unmarshal(raw, &document))

	expected := map[string][]string{
		"list-organizations": {"403", "500"},
		"list-prompts":       {"403", "500"},
		"get-random-prompt":  {"403", "500"},
	}
	seen := make(map[string]bool, len(expected))
	for _, path := range document.Paths {
		for _, operation := range path {
			statuses, ok := expected[operation.OperationID]
			if !ok {
				continue
			}
			seen[operation.OperationID] = true
			for _, status := range statuses {
				require.Contains(t, operation.Responses, status, "%s must declare HTTP %s", operation.OperationID, status)
			}
		}
	}
	for operationID := range expected {
		require.True(t, seen[operationID], "operation %s was not registered", operationID)
	}
}

func workspaceResponseIDsFromBody(t *testing.T, body []byte) []string {
	t.Helper()
	var workspaces []WorkspaceResponse
	require.NoError(t, json.Unmarshal(body, &workspaces))
	ids := make([]string, 0, len(workspaces))
	for _, workspace := range workspaces {
		ids = append(ids, workspace.WorkspaceID)
	}
	return ids
}

type workspaceCredentialRequest struct {
	method string
	path   string
	body   any
}

func (request *workspaceCredentialRequest) send(
	t *testing.T,
	server *workspaceTestServer,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	switch request.method {
	case http.MethodGet:
		return server.getJSON(t, request.path, token)
	case http.MethodPost:
		return server.postJSON(t, request.path, request.body, token)
	case http.MethodPatch:
		return server.patchJSON(t, request.path, request.body, token)
	case http.MethodDelete:
		return server.deleteJSON(t, request.path, token)
	default:
		t.Fatalf("unsupported test request method %q", request.method)
		return nil
	}
}

func newWorkspaceCredentialAccessTestServer(
	t *testing.T,
	authenticator middleware.Authenticator,
) *workspaceTestServer {
	t.Helper()

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
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewWorkspaceHandler(db, authenticator, entitlements.NewSelfHostedService())
	handler.SetFrontendURL("https://app.openpost.test")
	handler.ListOrganizations(api)
	handler.ListWorkspaces(api)
	handler.ListWorkspaceTeam(api)
	handler.CreateWorkspaceInvitation(api)
	handler.ResendWorkspaceInvitation(api)
	handler.RevokeWorkspaceInvitation(api)
	handler.UpdateWorkspaceMember(api)
	handler.RemoveWorkspaceMember(api)
	handler.ListWorkspaceAccessAudit(api)
	handler.AcceptWorkspaceInvitation(api)
	return &workspaceTestServer{echo: e, db: db}
}

func seedWorkspaceCredentialAccessFixture(t *testing.T, db *bun.DB) {
	t.Helper()

	now := time.Now().UTC().Truncate(time.Second)
	rows := []any{
		&models.User{ID: workspaceCredentialAdminUserID, Email: "admin@example.com", PasswordHash: "hash"},
		&models.User{ID: workspaceCredentialMemberUserID, Email: "member@example.com", PasswordHash: "hash"},
		&models.User{ID: workspaceCredentialInviteeUserID, Email: "invited@example.com", PasswordHash: "hash"},
		&models.Organization{
			ID: workspaceCredentialOrgID, Name: "Required SSO", CreatedByID: workspaceCredentialAdminUserID,
			CreatedAt: now,
		},
		&models.Organization{
			ID: workspaceCredentialPublicOrgID, Name: "Public", CreatedByID: workspaceCredentialAdminUserID,
			CreatedAt: now,
		},
		&models.OrganizationMember{
			OrganizationID: workspaceCredentialOrgID, UserID: workspaceCredentialAdminUserID,
			Role: models.OrganizationRoleOwner, CreatedAt: now,
		},
		&models.OrganizationMember{
			OrganizationID: workspaceCredentialPublicOrgID, UserID: workspaceCredentialAdminUserID,
			Role: models.OrganizationRoleOwner, CreatedAt: now,
		},
		&models.Workspace{
			ID: workspaceCredentialTestID, OrganizationID: workspaceCredentialOrgID,
			Name: "Required SSO", CreatedAt: now,
		},
		&models.Workspace{
			ID: workspaceCredentialPublicID, OrganizationID: workspaceCredentialPublicOrgID,
			Name: "Public", CreatedAt: now,
		},
		&models.WorkspaceMember{
			WorkspaceID: workspaceCredentialTestID, UserID: workspaceCredentialAdminUserID,
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: workspaceCredentialTestID, UserID: workspaceCredentialMemberUserID,
			Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: workspaceCredentialPublicID, UserID: workspaceCredentialAdminUserID,
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.IdentityProvider{
			ID: workspaceCredentialProviderID, OrganizationID: workspaceCredentialOrgID,
			Issuer: "https://idp.workspace-handler.example.test", Name: "Workspace handler SSO",
			ClientID: "workspace-handler-client", IsActive: true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: workspaceCredentialOrgID, Mode: models.OrganizationSSOModeRequired,
			ProviderIDs:             `["` + workspaceCredentialProviderID + `"]`,
			AssuranceMaxAgeSeconds:  int((12 * time.Hour).Seconds()),
			APITokenMode:            models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.APIToken{
			ID: workspaceCredentialUnboundToken, UserID: workspaceCredentialAdminUserID,
			Name: "All workspaces", TokenHash: "workspace-unbound-hash", TokenPrefix: "unbound",
			Scope: apitokens.ScopeCLI, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: workspaceCredentialBoundToken, UserID: workspaceCredentialAdminUserID,
			Name: "Required SSO", TokenHash: "workspace-bound-hash", TokenPrefix: "bound",
			Scope: apitokens.ScopeCLI, WorkspaceID: workspaceCredentialTestID,
			OrganizationID: workspaceCredentialOrgID, IdentityProviderID: workspaceCredentialProviderID,
			AssuredAt: now, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: workspaceCredentialInviteeTokenID, UserID: workspaceCredentialInviteeUserID,
			Name: "Invitee all workspaces", TokenHash: "workspace-invitee-unbound-hash",
			TokenPrefix: "invitee-unbound", Scope: apitokens.ScopeCLI, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.SessionIdentityAssurance{
			SessionID: workspaceCredentialInviteeSessionID, ProviderID: workspaceCredentialProviderID,
			UserID: workspaceCredentialInviteeUserID, AuthTime: now,
			ExpiresAt: now.Add(12 * time.Hour), CreatedAt: now,
		},
		&models.WorkspaceInvitation{
			ID: workspaceCredentialInvitationID, WorkspaceID: workspaceCredentialTestID,
			Email: "invited@example.com", Role: models.WorkspaceRoleViewer,
			InvitedByUserID: workspaceCredentialAdminUserID, TokenHash: "unchanged-token-hash",
			ExpiresAt: now.Add(24 * time.Hour), LastSentAt: now, CreatedAt: now,
		},
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
}
