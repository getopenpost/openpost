package handlers

import (
	"context"
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
	publicationHandler := NewPublicationHandler(db, authenticator, nil)
	publicationHandler.RegisterRoutes(api)
	requestPublications := func(token, path string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp := httptest.NewRecorder()
		e.ServeHTTP(resp, req)
		return resp
	}

	require.Equal(t, http.StatusForbidden, requestPublications(
		"unbound-token",
		"/api/v1/publications?workspace_id="+protectedEnumerationWorkspaceID,
	).Code)
	require.Equal(t, http.StatusForbidden, requestPublications(
		"bound-token",
		"/api/v1/publications?workspace_id="+publicEnumerationWorkspaceID,
	).Code)
	require.Equal(t, http.StatusOK, requestPublications(
		"bound-token",
		"/api/v1/publications?workspace_id="+protectedEnumerationWorkspaceID,
	).Code)
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
