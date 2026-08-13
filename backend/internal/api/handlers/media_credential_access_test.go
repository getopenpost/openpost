package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	echoMiddleware "github.com/labstack/echo/v4/middleware"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/stretchr/testify/require"
)

type mediaAccessAuthenticator map[string]middleware.Principal

func (a mediaAccessAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	principal, ok := a[token]
	if !ok {
		return nil, errors.New("invalid test token")
	}
	return &principal, nil
}

func TestMediaBearerQueryAuthorizationAndCachePolicy(t *testing.T) {
	t.Parallel()

	const (
		userID     = "media-user"
		workspace1 = "media-workspace-1"
		workspace2 = "media-workspace-2"
		org1       = "media-organization-1"
		org2       = "media-organization-2"
		providerID = "media-provider"
		mediaID    = "private-media"
	)
	now := time.Now().UTC().Truncate(time.Second)
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
		(*models.MediaAttachment)(nil),
	)
	rows := []any{
		&models.User{ID: userID, Email: "media@example.com", PasswordHash: "hash", CreatedAt: now},
		&models.Organization{ID: org1, Name: "Public", CreatedByID: userID, CreatedAt: now},
		&models.Organization{ID: org2, Name: "Protected", CreatedByID: userID, CreatedAt: now},
		&models.Workspace{ID: workspace1, OrganizationID: org1, Name: "One", CreatedAt: now},
		&models.Workspace{ID: workspace2, OrganizationID: org2, Name: "Two", CreatedAt: now},
		&models.WorkspaceMember{
			WorkspaceID: workspace1, UserID: userID, Role: models.WorkspaceRoleAdmin,
			Status: models.WorkspaceMemberStatusActive,
		},
		&models.WorkspaceMember{
			WorkspaceID: workspace2, UserID: userID, Role: models.WorkspaceRoleAdmin,
			Status: models.WorkspaceMemberStatusActive,
		},
		&models.IdentityProvider{
			ID: providerID, OrganizationID: org2, Issuer: "https://media-idp.example.test",
			Name: "Media SSO", ClientID: "media-client", IsActive: true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: org2, Mode: models.OrganizationSSOModeRequired,
			ProviderIDs: `["` + providerID + `"]`, AssuranceMaxAgeSeconds: int((12 * time.Hour).Seconds()),
			APITokenMode: models.OrganizationSSOTokensScoped, MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.SessionIdentityAssurance{
			SessionID: "browser-session", ProviderID: providerID, UserID: userID,
			AuthTime: now, ExpiresAt: now.Add(12 * time.Hour), CreatedAt: now,
		},
		&models.APIToken{
			ID: "token-ws1", UserID: userID, Name: "Workspace one", TokenHash: "hash-ws1",
			TokenPrefix: "ws1token", Scope: apitokens.ScopeCLI, WorkspaceID: workspace1,
			OrganizationID: org1, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: "token-unbound", UserID: userID, Name: "Unbound", TokenHash: "hash-unbound",
			TokenPrefix: "unbound", Scope: apitokens.ScopeCLI, ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID: "token-ws2", UserID: userID, Name: "Workspace two", TokenHash: "hash-ws2",
			TokenPrefix: "ws2token", Scope: apitokens.ScopeCLI, WorkspaceID: workspace2,
			OrganizationID: org2, IdentityProviderID: providerID, AssuredAt: now,
			ExpiresAt: now.Add(24 * time.Hour),
		},
		&models.MediaAttachment{
			ID: mediaID, WorkspaceID: workspace2, FilePath: mediaID + ".bin", StorageType: "s3",
			MimeType: "application/octet-stream", Size: 7, OriginalFilename: "private.bin", CreatedAt: now,
		},
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	authenticator := mediaAccessAuthenticator{
		"browser": {
			UserID: userID, Email: "media@example.com", SessionID: "browser-session",
		},
		"cli-ws1": {
			UserID: userID, Scope: apitokens.ScopeCLI, WorkspaceID: workspace1, TokenID: "token-ws1",
		},
		"cli-unbound": {
			UserID: userID, Scope: apitokens.ScopeCLI, TokenID: "token-unbound",
		},
		"cli-ws2": {
			UserID: userID, Scope: apitokens.ScopeCLI, WorkspaceID: workspace2, TokenID: "token-ws2",
		},
		"api-read": {
			UserID: userID, Scope: apitokens.ScopeAPIRead, TokenID: "api-read-token",
		},
		"mcp": {
			UserID: userID, Scope: apitokens.ScopeMCP, Audience: "https://app.openpost.test/mcp",
		},
	}
	storage := newFakeDirectUploadStorage()
	storage.objects[mediaID+".bin"] = []byte("private")
	signer := mediasigner.New("media-test-secret")
	handler := NewMediaHandler(db, storage, nil, authenticator, signer)
	e := echo.New()
	e.Use(echoMiddleware.CORSWithConfig(echoMiddleware.CORSConfig{
		AllowOrigins:     []string{"https://app.openpost.test"},
		AllowMethods:     []string{http.MethodGet},
		AllowHeaders:     []string{echo.HeaderOrigin, echo.HeaderAuthorization},
		AllowCredentials: true,
	}))
	handler.RegisterLegacyRoutes(e)

	request := func(token, transport, origin string) *httptest.ResponseRecorder {
		t.Helper()
		path := "/media/" + mediaID
		if transport == "query" {
			path += "?token=" + url.QueryEscape(token)
		}
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		if transport == "header" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if origin != "" {
			req.Header.Set(echo.HeaderOrigin, origin)
		}
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}

	for _, test := range []struct {
		token     string
		transport string
	}{
		{token: "cli-ws1", transport: "header"},
		{token: "cli-ws1", transport: "query"},
		{token: "cli-unbound", transport: "query"},
		{token: "api-read", transport: "header"},
		{token: "api-read", transport: "query"},
		{token: "mcp", transport: "query"},
	} {
		response := request(test.token, test.transport, "")
		require.Equal(t, http.StatusForbidden, response.Code, "%s %s: %s", test.transport, test.token, response.Body.String())
	}

	for _, test := range []struct {
		token     string
		transport string
	}{
		{token: "cli-ws2", transport: "header"},
		{token: "cli-ws2", transport: "query"},
		{token: "browser", transport: "query"},
	} {
		response := request(test.token, test.transport, "")
		require.Equal(t, http.StatusOK, response.Code, "%s %s: %s", test.transport, test.token, response.Body.String())
		require.Equal(t, "private, max-age=86400", response.Header().Get("Cache-Control"))
		require.Equal(t, "Origin, Authorization, Cookie", response.Header().Get("Vary"))
	}

	corsResponse := request("cli-ws2", "header", "https://app.openpost.test")
	require.Equal(t, http.StatusOK, corsResponse.Code, corsResponse.Body.String())
	require.Equal(t, "private, max-age=86400", corsResponse.Header().Get("Cache-Control"))
	require.Equal(t, "https://app.openpost.test", corsResponse.Header().Get(echo.HeaderAccessControlAllowOrigin))
	require.Equal(t, "Origin, Authorization, Cookie", corsResponse.Header().Get(echo.HeaderVary))

	expiresAt := now.Add(time.Hour)
	signature := signer.Sign(mediaID, expiresAt)
	signed := httptest.NewRequestWithContext(
		t.Context(), http.MethodGet,
		fmt.Sprintf("/media/%s?exp=%d&sig=%s", mediaID, expiresAt.Unix(), signature), nil,
	)
	signed.Header.Set(echo.HeaderOrigin, "https://app.openpost.test")
	signedResponse := httptest.NewRecorder()
	e.ServeHTTP(signedResponse, signed)
	require.Equal(t, http.StatusOK, signedResponse.Code, signedResponse.Body.String())
	var signedMaxAge int64
	_, err := fmt.Sscanf(signedResponse.Header().Get("Cache-Control"), "public, max-age=%d", &signedMaxAge)
	require.NoError(t, err)
	require.Greater(t, signedMaxAge, int64(0))
	require.LessOrEqual(t, signedMaxAge, expiresAt.Unix()-time.Now().UTC().Unix())
	require.Equal(t, "https://app.openpost.test", signedResponse.Header().Get(echo.HeaderAccessControlAllowOrigin))
	require.Equal(t, "Origin", signedResponse.Header().Get(echo.HeaderVary))
}

func TestSetCredentialMediaCacheMergesVaryHeadersWithoutDuplicates(t *testing.T) {
	t.Parallel()

	e := echo.New()
	response := httptest.NewRecorder()
	ctx := e.NewContext(httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/media/test", nil), response)
	ctx.Response().Header().Add(echo.HeaderVary, "Origin, authorization")
	ctx.Response().Header().Add(echo.HeaderVary, "Cookie")

	setCredentialMediaCache(ctx)
	setCredentialMediaCache(ctx)

	require.Equal(t, "private, max-age=86400", response.Header().Get("Cache-Control"))
	require.Equal(t, []string{"Origin", "authorization", "Cookie"}, strings.Split(response.Header().Get(echo.HeaderVary), ", "))
}
