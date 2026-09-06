package handlers

import (
	"bytes"
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
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/apitokens"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	repostCredentialSSOWorkspaceID    = "repost-required-sso"
	repostCredentialPublicWorkspaceID = "repost-public"
	repostCredentialOrganizationID    = "repost-organization"
	repostCredentialProviderID        = "repost-provider"
	repostCredentialUnboundTokenID    = "repost-unbound-token"
	repostCredentialBoundTokenID      = "repost-bound-token"
	repostCredentialBrowserSessionID  = "repost-browser-session"
	repostCredentialSourceAccountID   = "repost-source-account"
	repostCredentialTargetAccountID   = "repost-target-account"
	repostCredentialInactiveWorkspace = "repost-inactive-workspace"
	repostCredentialInactiveAccount   = "repost-inactive-account"
)

type repostCredentialAdapter struct {
	platform.Adapter
}

func (*repostCredentialAdapter) Repost(
	context.Context,
	string,
	string,
	platform.RepostRequest,
) (platform.RepostResult, error) {
	return platform.RepostResult{}, nil
}

type repostCredentialTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func TestRepostHandlersRequireCredentialAccessibleWorkspace(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"unbound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: repostCredentialUnboundTokenID,
		},
		"bound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: repostCredentialBoundTokenID,
			WorkspaceID: repostCredentialSSOWorkspaceID,
		},
		"assured-browser": {
			UserID: "user-1", Email: "user@example.com",
			SessionID: repostCredentialBrowserSessionID,
		},
	}
	server := newRepostCredentialTestServer(t, authenticator)
	seedRepostCredentialFixture(t, server.db)

	for _, request := range []struct {
		method string
		path   string
		body   any
	}{
		{method: http.MethodGet, path: "/api/v1/repost-automation?workspace_id=" + repostCredentialSSOWorkspaceID},
		{method: http.MethodPut, path: "/api/v1/repost-automation", body: map[string]any{
			"workspace_id": repostCredentialSSOWorkspaceID, "policies": []any{},
		}},
		{method: http.MethodDelete, path: "/api/v1/repost-account-grants/missing?workspace_id=" + repostCredentialSSOWorkspaceID},
	} {
		response := server.request(t, request.method, request.path, request.body, "unbound-token")
		require.Equal(t, http.StatusForbidden, response.Code, "%s %s: %s", request.method, request.path, response.Body.String())
	}

	for _, request := range []struct {
		method string
		path   string
		body   any
	}{
		{method: http.MethodGet, path: "/api/v1/repost-automation?workspace_id=" + repostCredentialPublicWorkspaceID},
		{method: http.MethodPut, path: "/api/v1/repost-automation", body: map[string]any{
			"workspace_id": repostCredentialPublicWorkspaceID, "policies": []any{},
		}},
		{method: http.MethodDelete, path: "/api/v1/repost-account-grants/missing?workspace_id=" + repostCredentialPublicWorkspaceID},
	} {
		response := server.request(t, request.method, request.path, request.body, "bound-token")
		require.Equal(t, http.StatusForbidden, response.Code, "%s %s: %s", request.method, request.path, response.Body.String())
	}

	settings := server.request(
		t,
		http.MethodGet,
		"/api/v1/repost-automation?workspace_id="+repostCredentialSSOWorkspaceID,
		nil,
		"bound-token",
	)
	require.Equal(t, http.StatusOK, settings.Code, settings.Body.String())
	replaced := server.request(t, http.MethodPut, "/api/v1/repost-automation", map[string]any{
		"workspace_id": repostCredentialSSOWorkspaceID, "policies": []any{},
	}, "bound-token")
	require.Equal(t, http.StatusOK, replaced.Code, replaced.Body.String())
}

func TestRepostCrossWorkspaceTargetsRequireCredentialAccessBeforeGrant(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"unbound-token": {
			UserID: "user-1", Email: "user@example.com",
			Scope: apitokens.ScopeCLI, TokenID: repostCredentialUnboundTokenID,
		},
		"assured-browser": {
			UserID: "user-1", Email: "user@example.com",
			SessionID: repostCredentialBrowserSessionID,
		},
	}
	server := newRepostCredentialTestServer(t, authenticator)
	seedRepostCredentialFixture(t, server.db)

	unboundSettings := server.request(
		t,
		http.MethodGet,
		"/api/v1/repost-automation?workspace_id="+repostCredentialPublicWorkspaceID,
		nil,
		"unbound-token",
	)
	require.Equal(t, http.StatusOK, unboundSettings.Code, unboundSettings.Body.String())
	require.Contains(t, repostAccountIDs(t, unboundSettings), repostCredentialSourceAccountID)
	require.NotContains(t, repostAccountIDs(t, unboundSettings), repostCredentialTargetAccountID)
	require.NotContains(t, repostAccountIDs(t, unboundSettings), repostCredentialInactiveAccount)

	policy := map[string]any{
		"name":               "Protected target",
		"enabled":            true,
		"source_account_ids": []string{repostCredentialSourceAccountID},
		"target_account_ids": []string{repostCredentialTargetAccountID},
		"rule": map[string]any{
			"delay_seconds": 0, "evaluation_window_seconds": 900,
			"threshold_mode": "all", "plateau_checks": 2,
			"min_likes": 0, "min_comments": 0, "min_reposts": 0, "min_views": 0,
			"require_plateau": false,
		},
	}
	denied := server.request(t, http.MethodPut, "/api/v1/repost-automation", map[string]any{
		"workspace_id": repostCredentialPublicWorkspaceID,
		"policies":     []any{policy},
	}, "unbound-token")
	require.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())
	repostCredentialCounts(t, server.db, 0, 0)

	browserSettings := server.request(
		t,
		http.MethodGet,
		"/api/v1/repost-automation?workspace_id="+repostCredentialPublicWorkspaceID,
		nil,
		"assured-browser",
	)
	require.Equal(t, http.StatusOK, browserSettings.Code, browserSettings.Body.String())
	require.Contains(t, repostAccountIDs(t, browserSettings), repostCredentialTargetAccountID)
	require.NotContains(t, repostAccountIDs(t, browserSettings), repostCredentialInactiveAccount)

	granted := server.request(t, http.MethodPut, "/api/v1/repost-automation", map[string]any{
		"workspace_id": repostCredentialPublicWorkspaceID,
		"policies":     []any{policy},
	}, "assured-browser")
	require.Equal(t, http.StatusOK, granted.Code, granted.Body.String())
	repostCredentialCounts(t, server.db, 1, 1)

	delegatedSettings := server.request(
		t,
		http.MethodGet,
		"/api/v1/repost-automation?workspace_id="+repostCredentialPublicWorkspaceID,
		nil,
		"unbound-token",
	)
	require.Equal(t, http.StatusOK, delegatedSettings.Code, delegatedSettings.Body.String())
	require.Contains(t, repostAccountIDs(t, delegatedSettings), repostCredentialTargetAccountID,
		"the active workspace grant deliberately delegates this account to source-workspace admins")
	require.Equal(t, []string{repostCredentialTargetAccountID}, repostSettings(t, delegatedSettings).Policies[0].TargetAccountIDs)

	_, err := server.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", repostCredentialTargetAccountID).
		Exec(t.Context())
	require.NoError(t, err)
	inactiveSettings := server.request(
		t,
		http.MethodGet,
		"/api/v1/repost-automation?workspace_id="+repostCredentialPublicWorkspaceID,
		nil,
		"unbound-token",
	)
	require.Equal(t, http.StatusOK, inactiveSettings.Code, inactiveSettings.Body.String())
	require.NotContains(t, repostAccountIDs(t, inactiveSettings), repostCredentialTargetAccountID)
	require.Empty(t, repostSettings(t, inactiveSettings).Policies[0].TargetAccountIDs)
	require.Empty(t, repostSettings(t, inactiveSettings).Grants)
	_, err = server.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", true).
		Where("id = ?", repostCredentialTargetAccountID).
		Exec(t.Context())
	require.NoError(t, err)

	_, err = server.db.NewUpdate().Model((*models.RepostAccountGrant)(nil)).
		Set("revoked_at = ?", time.Now().UTC()).
		Where("source_workspace_id = ? AND target_account_id = ?", repostCredentialPublicWorkspaceID, repostCredentialTargetAccountID).
		Exec(t.Context())
	require.NoError(t, err)

	revokedSettings := server.request(
		t,
		http.MethodGet,
		"/api/v1/repost-automation?workspace_id="+repostCredentialPublicWorkspaceID,
		nil,
		"unbound-token",
	)
	require.Equal(t, http.StatusOK, revokedSettings.Code, revokedSettings.Body.String())
	require.NotContains(t, repostAccountIDs(t, revokedSettings), repostCredentialTargetAccountID)
	require.Empty(t, repostSettings(t, revokedSettings).Policies[0].TargetAccountIDs,
		"a revoked grant must not leak a stale protected target assignment")
}

func newRepostCredentialTestServer(
	t *testing.T,
	authenticator middleware.Authenticator,
) *repostCredentialTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.SessionIdentityAssurance)(nil),
		(*models.APIToken)(nil),
		(*models.SocialAccount)(nil),
		(*models.RepostPolicy)(nil),
		(*models.RepostPolicyAccount)(nil),
		(*models.RepostAccountGrant)(nil),
	)
	service := repostservice.NewService(db, nil)
	service.SetProvider("x", &repostCredentialAdapter{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewRepostHandler(db, service, authenticator).RegisterRoutes(api)
	return &repostCredentialTestServer{echo: e, db: db}
}

func (server *repostCredentialTestServer) request(
	t *testing.T,
	method,
	path string,
	body any,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, req)
	return response
}

func seedRepostCredentialFixture(t *testing.T, db *bun.DB) {
	t.Helper()

	now := time.Now().UTC().Truncate(time.Second)
	rows := []any{
		&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"},
		&models.Organization{
			ID: repostCredentialOrganizationID, Name: "Repost SSO", CreatedByID: "user-1", CreatedAt: now,
		},
		&models.Workspace{
			ID: repostCredentialSSOWorkspaceID, OrganizationID: repostCredentialOrganizationID,
			Name: "Repost SSO", CreatedAt: now,
		},
		&models.Workspace{ID: repostCredentialPublicWorkspaceID, Name: "Repost public", CreatedAt: now},
		&models.Workspace{ID: repostCredentialInactiveWorkspace, Name: "Repost inactive", CreatedAt: now},
		&models.WorkspaceMember{
			WorkspaceID: repostCredentialSSOWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: repostCredentialPublicWorkspaceID, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: repostCredentialInactiveWorkspace, UserID: "user-1",
			Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusInactive,
		},
		&models.IdentityProvider{
			ID: repostCredentialProviderID, OrganizationID: repostCredentialOrganizationID,
			Issuer: "https://idp.repost-handler.example.test", Name: "Repost handler SSO",
			ClientID: "repost-handler-client", IsActive: true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: repostCredentialOrganizationID, Mode: models.OrganizationSSOModeRequired,
			ProviderIDs:             `["` + repostCredentialProviderID + `"]`,
			AssuranceMaxAgeSeconds:  int((12 * time.Hour).Seconds()),
			APITokenMode:            models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.SessionIdentityAssurance{
			SessionID: repostCredentialBrowserSessionID, ProviderID: repostCredentialProviderID,
			UserID: "user-1", AuthTime: now, ExpiresAt: now.Add(12 * time.Hour),
		},
		&models.APIToken{
			ID: repostCredentialUnboundTokenID, UserID: "user-1", Name: "All workspaces",
			TokenHash: "repost-unbound-hash", TokenPrefix: "unbound", Scope: apitokens.ScopeCLI,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: repostCredentialBoundTokenID, UserID: "user-1", Name: "Repost SSO",
			TokenHash: "repost-bound-hash", TokenPrefix: "bound", Scope: apitokens.ScopeCLI,
			WorkspaceID: repostCredentialSSOWorkspaceID, OrganizationID: repostCredentialOrganizationID,
			IdentityProviderID: repostCredentialProviderID, AssuredAt: now, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.SocialAccount{
			ID: repostCredentialSourceAccountID, WorkspaceID: repostCredentialPublicWorkspaceID,
			Slug: "source", Platform: "x", AccountID: "source", AccountUsername: "source",
			AccessTokenEnc: []byte("token"), IsActive: true,
		},
		&models.SocialAccount{
			ID: repostCredentialTargetAccountID, WorkspaceID: repostCredentialSSOWorkspaceID,
			Slug: "target", Platform: "x", AccountID: "target", AccountUsername: "target",
			AccessTokenEnc: []byte("token"), IsActive: true,
		},
		&models.SocialAccount{
			ID: repostCredentialInactiveAccount, WorkspaceID: repostCredentialInactiveWorkspace,
			Slug: "inactive", Platform: "x", AccountID: "inactive", AccountUsername: "inactive",
			AccessTokenEnc: []byte("token"), IsActive: true,
		},
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
}

func repostAccountIDs(t *testing.T, response *httptest.ResponseRecorder) []string {
	t.Helper()
	settings := repostSettings(t, response)
	ids := make([]string, 0, len(settings.Accounts))
	for _, account := range settings.Accounts {
		ids = append(ids, account.ID)
	}
	return ids
}

func repostSettings(t *testing.T, response *httptest.ResponseRecorder) repostservice.SettingsResponse {
	t.Helper()
	var settings repostservice.SettingsResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &settings))
	return settings
}

func repostCredentialCounts(t *testing.T, db *bun.DB, policyCount, grantCount int) {
	t.Helper()
	actualPolicies, err := db.NewSelect().Model((*models.RepostPolicy)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, policyCount, actualPolicies)
	actualGrants, err := db.NewSelect().Model((*models.RepostAccountGrant)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, grantCount, actualGrants)
}
