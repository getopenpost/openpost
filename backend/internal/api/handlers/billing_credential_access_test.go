package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/billing"
	usageservice "github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	billingCredentialWorkspaceID    = "billing-workspace"
	billingCredentialLegacyID       = "billing-legacy"
	billingCredentialOrganizationID = "billing-organization"
	billingCredentialUnboundTokenID = "billing-unbound-token"
	billingCredentialBoundTokenID   = "billing-bound-token"
	billingCredentialMemberTokenID  = "billing-member-token"
	billingCredentialLegacyTokenID  = "billing-legacy-token"
	billingCredentialForeignOrgID   = "billing-foreign-organization"
	billingCredentialForeignSpaceID = "billing-foreign-workspace"
)

type billingCredentialTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func TestGetBillingStatusRequiresOrganizationLevelCredentialAccess(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"browser-token": {UserID: "user-1", Email: "user@example.com", SessionID: "browser-session"},
		"unbound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: billingCredentialUnboundTokenID,
		},
		"bound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: billingCredentialBoundTokenID,
			WorkspaceID: billingCredentialWorkspaceID,
		},
		"member-browser-token": {UserID: "user-2", Email: "member@example.com", SessionID: "member-session"},
		"member-unbound-token": {
			UserID: "user-2", Email: "member@example.com",
			Scope: apitokens.ScopeCLI, TokenID: billingCredentialMemberTokenID,
		},
		"legacy-bound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: billingCredentialLegacyTokenID,
			WorkspaceID: billingCredentialLegacyID,
		},
	}
	server := newBillingCredentialTestServer(t, authenticator)
	seedBillingCredentialFixture(t, server.db)

	for _, token := range []string{"browser-token", "unbound-token"} {
		response := server.get(t, billingCredentialWorkspaceID, token)
		require.Equal(t, http.StatusOK, response.Code, "%s: %s", token, response.Body.String())
		require.Contains(t, response.Body.String(), `"plan_id":"team"`)
	}
	for _, token := range []string{"member-browser-token", "member-unbound-token"} {
		response := server.get(t, billingCredentialWorkspaceID, token)
		require.Equal(t, http.StatusOK, response.Code, "%s: %s", token, response.Body.String())
		require.Contains(t, response.Body.String(), `"plan_id":"team"`)
		require.Contains(t, response.Body.String(), `"can_manage_billing":false`)
	}

	bound := server.get(t, billingCredentialWorkspaceID, "bound-token")
	require.Equal(t, http.StatusForbidden, bound.Code, bound.Body.String())
	require.NotContains(t, bound.Body.String(), `"plan_id":"team"`)

	for _, token := range []string{"browser-token", "unbound-token"} {
		legacy := server.get(t, billingCredentialLegacyID, token)
		require.Equal(t, http.StatusOK, legacy.Code, "%s: %s", token, legacy.Body.String())
		require.Contains(t, legacy.Body.String(), `"workspace_id":"`+billingCredentialLegacyID+`"`)
	}
	legacyBound := server.get(t, billingCredentialLegacyID, "legacy-bound-token")
	require.Equal(t, http.StatusForbidden, legacyBound.Code, legacyBound.Body.String())

	matchedScope := server.getScope(
		t,
		billingCredentialOrganizationID,
		billingCredentialWorkspaceID,
		"browser-token",
	)
	require.Equal(t, http.StatusOK, matchedScope.Code, matchedScope.Body.String())
	require.Contains(t, matchedScope.Body.String(), `"plan_id":"team"`)

	mixedScope := server.getScope(
		t,
		billingCredentialOrganizationID,
		billingCredentialForeignSpaceID,
		"browser-token",
	)
	require.Equal(t, http.StatusForbidden, mixedScope.Code, mixedScope.Body.String())
	require.NotContains(t, mixedScope.Body.String(), billingCredentialForeignOrgID)
	require.NotContains(t, mixedScope.Body.String(), `"plan_id":"agency"`)
}

func newBillingCredentialTestServer(
	t *testing.T,
	authenticator workspaceTestAuthenticator,
) *billingCredentialTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingCustomer)(nil),
		(*models.UsageCounter)(nil),
		(*models.ProviderUsageEvent)(nil),
		(*models.ProviderUsageReservation)(nil),
		(*models.ProviderUsagePeriodCounter)(nil),
	)
	service := billing.NewService(db, "")
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewBillingHandler(service, db, authenticator)
	handler.SetUsage(usageservice.NewService(db))
	handler.RegisterAPIRoutes(api)
	return &billingCredentialTestServer{echo: e, db: db}
}

func (server *billingCredentialTestServer) get(
	t *testing.T,
	workspaceID,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/api/v1/billing/status?workspace_id="+workspaceID,
		nil,
	)
	req.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, req)
	return response
}

func (server *billingCredentialTestServer) getScope(
	t *testing.T,
	organizationID,
	workspaceID,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/api/v1/billing/status?organization_id="+organizationID+"&workspace_id="+workspaceID,
		nil,
	)
	req.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, req)
	return response
}

func seedBillingCredentialFixture(t *testing.T, db *bun.DB) {
	t.Helper()

	now := time.Now().UTC().Truncate(time.Second)
	rows := []any{
		&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"},
		&models.User{ID: "user-2", Email: "member@example.com", PasswordHash: "hash"},
		&models.Organization{
			ID: billingCredentialOrganizationID, Name: "Billing", CreatedByID: "user-1", CreatedAt: now,
		},
		&models.Organization{
			ID: billingCredentialForeignOrgID, Name: "Foreign billing", CreatedByID: "foreign-user", CreatedAt: now,
		},
		&models.OrganizationMember{
			OrganizationID: billingCredentialOrganizationID, UserID: "user-1",
			Role: models.OrganizationRoleOwner, CreatedAt: now,
		},
		&models.Workspace{
			ID: billingCredentialWorkspaceID, OrganizationID: billingCredentialOrganizationID,
			Name: "Billing", CreatedAt: now,
		},
		&models.Workspace{ID: billingCredentialLegacyID, Name: "Legacy", CreatedAt: now},
		&models.Workspace{
			ID: billingCredentialForeignSpaceID, OrganizationID: billingCredentialForeignOrgID,
			Name: "Foreign billing", CreatedAt: now,
		},
		&models.WorkspaceMember{
			WorkspaceID: billingCredentialWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: billingCredentialWorkspaceID, UserID: "user-2",
			Role: models.WorkspaceRoleViewer, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: billingCredentialLegacyID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.APIToken{
			ID: billingCredentialUnboundTokenID, UserID: "user-1", Name: "All workspaces",
			TokenHash: "billing-unbound-hash", TokenPrefix: "unbound", Scope: apitokens.ScopeCLI,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: billingCredentialBoundTokenID, UserID: "user-1", Name: "Billing workspace",
			TokenHash: "billing-bound-hash", TokenPrefix: "bound", Scope: apitokens.ScopeCLI,
			WorkspaceID: billingCredentialWorkspaceID, OrganizationID: billingCredentialOrganizationID,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: billingCredentialMemberTokenID, UserID: "user-2", Name: "Member workspaces",
			TokenHash: "billing-member-hash", TokenPrefix: "member", Scope: apitokens.ScopeCLI,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: billingCredentialLegacyTokenID, UserID: "user-1", Name: "Legacy workspace",
			TokenHash: "billing-legacy-hash", TokenPrefix: "legacy", Scope: apitokens.ScopeCLI,
			WorkspaceID: billingCredentialLegacyID, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.BillingSubscription{
			OrganizationID: billingCredentialOrganizationID, WorkspaceID: billingCredentialWorkspaceID,
			Provider: models.BillingProviderPaddle, ProviderCustomerID: "billing-customer",
			ProviderSubscriptionID: "billing-subscription", Status: "active", PlanID: "team",
			EntitlementSnapshot: `{"limits":{"social_accounts":25}}`, UpdatedAt: now,
		},
		&models.BillingSubscription{
			OrganizationID: billingCredentialForeignOrgID, WorkspaceID: billingCredentialForeignSpaceID,
			Provider: models.BillingProviderPaddle, ProviderCustomerID: "foreign-customer",
			ProviderSubscriptionID: "foreign-subscription", Status: "active", PlanID: "agency",
			EntitlementSnapshot: `{"limits":{"social_accounts":100}}`, UpdatedAt: now,
		},
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
}
