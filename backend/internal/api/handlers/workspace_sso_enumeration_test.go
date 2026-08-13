package handlers

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const (
	protectedEnumerationWorkspaceID = "workspace-sso-protected"
	publicEnumerationWorkspaceID    = "workspace-public"
	inactiveEnumerationWorkspaceID  = "workspace-inactive"
	boundEnumerationTokenID         = "enumeration-bound-token"
	unboundEnumerationTokenID       = "enumeration-unbound-token"
)

type workspaceEnumerationAuthenticator map[string]middleware.Principal

func (authenticator workspaceEnumerationAuthenticator) AuthenticateBearer(
	_ context.Context,
	token string,
) (*middleware.Principal, error) {
	principal, ok := authenticator[token]
	if !ok {
		return nil, errors.New("invalid token")
	}
	return &principal, nil
}

func TestRequiredSSOWorkspaceEnumerationUsesCredentialAccess(t *testing.T) {
	t.Parallel()

	db := newWorkspaceSSOEnumerationDB(t)
	seedWorkspaceSSOEnumerationFixture(t, db)

	unboundCtx := workspaceEnumerationContext(unboundEnumerationTokenID, "")
	boundCtx := workspaceEnumerationContext(boundEnumerationTokenID, protectedEnumerationWorkspaceID)
	jobHandler := NewJobHandler(db, nil)

	unboundJobs, err := jobHandler.allowedWorkspaces(unboundCtx, "user-1", false, "")
	require.NoError(t, err)
	require.Equal(t, map[string]bool{publicEnumerationWorkspaceID: true}, unboundJobs)
	boundJobs, err := jobHandler.allowedWorkspaces(boundCtx, "user-1", false, "")
	require.NoError(t, err)
	require.Equal(t, map[string]bool{protectedEnumerationWorkspaceID: true}, boundJobs)
	bearerAdminJobs, err := jobHandler.allowedWorkspaces(unboundCtx, "user-1", true, "")
	require.NoError(t, err)
	require.Equal(t, map[string]bool{publicEnumerationWorkspaceID: true}, bearerAdminJobs)
	browserAdminCtx := context.WithValue(unboundCtx, middleware.SessionIDKey, "browser-session")
	globalAdminJobs, err := jobHandler.allowedWorkspaces(browserAdminCtx, "user-1", true, "")
	require.NoError(t, err)
	require.Nil(t, globalAdminJobs, "browser instance administrators intentionally retain the global operational queue")

	postHandler := NewPostHandler(db, nil)
	unboundPosts, err := postHandler.listPostWorkspaceIDs(unboundCtx, "")
	require.NoError(t, err)
	require.Equal(t, []string{publicEnumerationWorkspaceID}, unboundPosts)
	boundPosts, err := postHandler.listPostWorkspaceIDs(boundCtx, "")
	require.NoError(t, err)
	require.Equal(t, []string{protectedEnumerationWorkspaceID}, boundPosts)
	require.NotContains(t, unboundPosts, inactiveEnumerationWorkspaceID)

	authenticator := workspaceEnumerationAuthenticator{
		"unbound-token": {
			UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeCLI,
			TokenID: unboundEnumerationTokenID,
		},
		"bound-token": {
			UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeCLI,
			WorkspaceID: protectedEnumerationWorkspaceID, TokenID: boundEnumerationTokenID,
		},
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostHandler(db, authenticator).GetScheduleOverview(api)
	requestOverview := func(token, path string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp := httptest.NewRecorder()
		e.ServeHTTP(resp, req)
		return resp
	}
	decodeOverview := func(resp *httptest.ResponseRecorder) ScheduleOverviewOutput {
		require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
		var overview ScheduleOverviewOutput
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &overview.Body))
		return overview
	}

	unboundOverview := decodeOverview(requestOverview(
		"unbound-token",
		"/api/v1/posts/schedule-overview?month=2026-07",
	))
	require.Equal(t, publicEnumerationWorkspaceID, unboundOverview.Body.SelectedWorkspaceID)
	require.Equal(t, []string{publicEnumerationWorkspaceID}, workspaceResponseIDs(unboundOverview.Body.Workspaces))
	require.Equal(t, http.StatusForbidden, requestOverview(
		"unbound-token",
		"/api/v1/posts/schedule-overview?workspace_id="+protectedEnumerationWorkspaceID+"&month=2026-07",
	).Code)

	boundOverview := decodeOverview(requestOverview(
		"bound-token",
		"/api/v1/posts/schedule-overview?month=2026-07",
	))
	require.Equal(t, protectedEnumerationWorkspaceID, boundOverview.Body.SelectedWorkspaceID)
	require.Equal(t, []string{protectedEnumerationWorkspaceID}, workspaceResponseIDs(boundOverview.Body.Workspaces))
}

func newWorkspaceSSOEnumerationDB(t *testing.T) *bun.DB {
	t.Helper()
	return createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.APIToken)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
	)
}

func seedWorkspaceSSOEnumerationFixture(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Second)
	for _, model := range []any{
		&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"},
		&models.Organization{ID: "organization-sso", Name: "SSO", CreatedByID: "user-1"},
		&models.IdentityProvider{
			ID: "provider-sso", OrganizationID: "organization-sso",
			Issuer: "https://idp.enumeration.example.test", Name: "Enumeration SSO",
			ClientID: "enumeration-client", IsActive: true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: "organization-sso", Mode: models.OrganizationSSOModeRequired,
			ProviderIDs: `["provider-sso"]`, AssuranceMaxAgeSeconds: int((12 * time.Hour).Seconds()),
			APITokenMode:            models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.APIToken{
			ID: unboundEnumerationTokenID, UserID: "user-1", Name: "Unbound",
			TokenHash: "enumeration-unbound-hash", TokenPrefix: "unbound", Scope: apitokens.ScopeCLI,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: boundEnumerationTokenID, UserID: "user-1", Name: "Bound",
			TokenHash: "enumeration-bound-hash", TokenPrefix: "bound", Scope: apitokens.ScopeCLI,
			WorkspaceID: protectedEnumerationWorkspaceID, OrganizationID: "organization-sso",
			IdentityProviderID: "provider-sso", AssuredAt: now, ExpiresAt: now.Add(24 * time.Hour),
		},
	} {
		_, err := db.NewInsert().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
	workspaces := []models.Workspace{
		{ID: inactiveEnumerationWorkspaceID, Name: "Inactive", CreatedAt: now.Add(3 * time.Hour)},
		{ID: protectedEnumerationWorkspaceID, Name: "Protected", OrganizationID: "organization-sso", CreatedAt: now.Add(2 * time.Hour)},
		{ID: publicEnumerationWorkspaceID, Name: "Public", CreatedAt: now.Add(time.Hour)},
	}
	_, err := db.NewInsert().Model(&workspaces).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: protectedEnumerationWorkspaceID, UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: publicEnumerationWorkspaceID, UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive},
		{WorkspaceID: inactiveEnumerationWorkspaceID, UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusInactive},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)
}

func workspaceEnumerationContext(tokenID, workspaceID string) context.Context {
	ctx := context.WithValue(context.Background(), middleware.UserIDKey, "user-1")
	ctx = context.WithValue(ctx, middleware.TokenIDKey, tokenID)
	if workspaceID != "" {
		ctx = context.WithValue(ctx, middleware.WorkspaceIDKey, workspaceID)
	}
	return ctx
}

func workspaceResponseIDs(workspaces []WorkspaceResp) []string {
	ids := make([]string, 0, len(workspaces))
	for _, workspace := range workspaces {
		ids = append(ids, workspace.WorkspaceID)
	}
	return ids
}
