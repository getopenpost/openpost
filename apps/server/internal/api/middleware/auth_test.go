package middleware

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

// fakeAuthenticator stands in for the real composite authenticator.
// Each test sets nextErr/nextPrincipal to drive the middleware's
// behavior.
type fakeAuthenticator struct {
	principal *Principal
	err       error
	gotToken  string
}

func (f *fakeAuthenticator) AuthenticateBearer(_ context.Context, token string) (*Principal, error) {
	f.gotToken = token
	return f.principal, f.err
}

type humaAuthTestInput struct{}

type humaAuthTestOutput struct {
	Body struct {
		OK bool `json:"ok"`
	}
}

func newHumaAuthed(authenticator Authenticator, called *bool) *echo.Echo {
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	huma.Register(api, huma.Operation{
		OperationID: "middleware-auth-test",
		Method:      http.MethodGet,
		Path:        "/auth-test",
		Middlewares: huma.Middlewares{AuthMiddleware(api, authenticator)},
	}, func(context.Context, *humaAuthTestInput) (*humaAuthTestOutput, error) {
		*called = true
		output := &humaAuthTestOutput{}
		output.Body.OK = true
		return output, nil
	})
	return e
}

func TestExternalApplicationRESTAccessRequiresExactGrant(t *testing.T) {
	principal := &Principal{
		Scope:           apitokens.ScopeExternalApp,
		Audience:        "https://app.openpost.test/api/v1",
		InstallationID:  "installation-1",
		DelegatedScopes: "workspace:read drafts:write events:subscribe",
	}

	require.True(t, PrincipalCanAccessREST(principal, "list-workspaces"))
	require.True(t, PrincipalCanAccessREST(principal, "create-publication"))
	require.True(t, PrincipalCanAccessREST(principal, "create-external-webhook"))
	require.False(t, PrincipalCanAccessREST(principal, "list-publications"))
	require.False(t, PrincipalCanAccessREST(principal, "delete-publication"))
	require.False(t, PrincipalCanAccessREST(principal, "optimize-media-image"))
	principal.DelegatedScopes += " media:write"
	require.True(t, PrincipalCanAccessREST(principal, "optimize-media-image"))
	require.False(t, PrincipalCanAccessREST(&Principal{Scope: apitokens.ScopeAPIRead}, "optimize-media-image"))
	require.False(t, PrincipalCanAccessREST(principal))
	require.False(t, PrincipalCanAccessREST(&Principal{
		Scope:           apitokens.ScopeExternalApp,
		InstallationID:  "installation-1",
		DelegatedScopes: "workspace:read",
	}, "list-workspaces"))
	require.False(t, PrincipalCanAccessREST(&Principal{
		Scope:           apitokens.ScopeExternalApp,
		Audience:        "https://app.openpost.test/api/v1",
		DelegatedScopes: "workspace:read",
	}, "list-workspaces"))
}

type rejectingAuthenticator struct{}

func (rejectingAuthenticator) AuthenticateBearer(_ context.Context, _ string) (*Principal, error) {
	return nil, errors.New("invalid jwt")
}

func TestCompositeServicePreservesAPITokenScope(t *testing.T) {
	ctx := context.Background()
	sqldb, err := sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	if err != nil {
		t.Fatal(err)
	}
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	})
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
	} {
		if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
	}).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx); err != nil {
		t.Fatal(err)
	}

	tokenService := apitokens.NewService(db)
	generated, err := tokenService.GenerateTokenWithOptions(ctx, "user-1", "ChatGPT", apitokens.ScopeMCP, apitokens.GenerateOptions{
		WorkspaceID: "ws-1",
		Audience:    "https://app.openpost.test/mcp",
	})
	if err != nil {
		t.Fatal(err)
	}
	composite := &CompositeService{jwt: rejectingAuthenticator{}, apiTokens: tokenService}

	principal, err := composite.AuthenticateBearer(ctx, generated.Token)
	if err != nil {
		t.Fatal(err)
	}
	if principal.Scope != apitokens.ScopeMCP {
		t.Fatalf("expected scope %q, got %q", apitokens.ScopeMCP, principal.Scope)
	}
	if principal.WorkspaceID != "ws-1" {
		t.Fatalf("expected workspace id %q, got %q", "ws-1", principal.WorkspaceID)
	}
	if principal.Audience != "https://app.openpost.test/mcp" {
		t.Fatalf("expected audience %q, got %q", "https://app.openpost.test/mcp", principal.Audience)
	}
	if principal.ClientID != generated.Model.ID {
		t.Fatalf("expected client id %q, got %q", generated.Model.ID, principal.ClientID)
	}
	if principal.ClientName != "ChatGPT" {
		t.Fatalf("expected client name %q, got %q", "ChatGPT", principal.ClientName)
	}
	if principal.TokenPrefix != generated.Model.TokenPrefix {
		t.Fatalf("expected token prefix %q, got %q", generated.Model.TokenPrefix, principal.TokenPrefix)
	}
}

func TestJWTAuthenticatorRejectsRevokedSession(t *testing.T) {
	ctx := context.Background()
	sqldb, err := sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	for _, model := range []interface{}{
		(*models.User)(nil),
		(*models.UserSession)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)

	authService := auth.NewService("test-secret")
	sessionService := sessions.NewService(db)
	session, err := sessionService.CreateSession(ctx, sessions.CreateInput{
		UserID:    "user-1",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession("user-1", "user@example.com", session.ID, session.ExpiresAt)
	require.NoError(t, err)

	authenticator := NewJWTAuthenticatorWithSessions(authService, sessionService)
	principal, err := authenticator.AuthenticateBearer(ctx, token)
	require.NoError(t, err)
	require.Equal(t, session.ID, principal.SessionID)

	require.NoError(t, sessionService.RevokeSession(ctx, "user-1", session.ID))
	_, err = authenticator.AuthenticateBearer(ctx, token)
	require.Error(t, err)
}

func TestSessionBearerRejectsForeignOrigin(t *testing.T) {
	for _, origin := range []string{"https://evil.example", "http://app.openpost.test", "https://app.openpost.test:444"} {
		t.Run(origin, func(t *testing.T) {
			called := false
			e := newHumaAuthed(&fakeAuthenticator{principal: &Principal{UserID: "user", SessionID: "session"}}, &called)
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "https://app.openpost.test/api/v1/auth-test", nil)
			req.Header.Set("Authorization", "Bearer session-token")
			req.Header.Set("Origin", origin)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, http.StatusForbidden, rec.Code)
			require.False(t, called)
		})
	}
}

func TestTrustedProxyNetworkAssertions(t *testing.T) {
	for _, tc := range []struct{ name, peer, forwarded, wantIP, proto, wantProto, prefix string }{
		{"direct spoof", "203.0.113.4:5000", "1.2.3.4", "203.0.113.4", "https", "", "10.0.0.0/24"},
		{"trusted hop", "10.0.0.2:5000", "1.2.3.4, 203.0.113.4", "203.0.113.4", "https", "https", "10.0.0.0/24"},
		{"trusted chain", "10.0.0.2:5000", "203.0.113.4, 10.0.0.1", "203.0.113.4", "https", "https", "10.0.0.0/24"},
		{"mapped CIDR", "10.0.0.2:5000", "203.0.113.4", "203.0.113.4", "https", "https", "::ffff:10.0.0.0/120"},
		{"mapped peer", "[::ffff:10.0.0.2]:5000", "203.0.113.4", "203.0.113.4", "https", "https", "::ffff:10.0.0.0/120"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			e := echo.New()
			UseTrustedProxies(e, []string{tc.prefix})
			e.GET("/", func(c echo.Context) error {
				called = true
				require.Equal(t, tc.wantIP, c.RealIP())
				require.Equal(t, tc.wantProto, c.Request().Header.Get("X-Forwarded-Proto"))
				expectedScheme := tc.wantProto
				if expectedScheme == "" {
					expectedScheme = "http"
				}
				require.Equal(t, expectedScheme, c.Scheme())
				return c.NoContent(200)
			})
			req := httptest.NewRequestWithContext(t.Context(), "GET", "http://app.openpost.test/", nil)
			req.RemoteAddr = tc.peer
			req.Header.Set("X-Forwarded-For", tc.forwarded)
			req.Header.Set("X-Forwarded-Proto", tc.proto)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.True(t, called, "trusted proxy middleware must forward the request")
			require.Equal(t, http.StatusOK, rec.Code)
		})
	}
	for header, value := range map[string]string{"X-Forwarded-Protocol": "https", "X-Forwarded-Ssl": "on", "X-Url-Scheme": "https"} {
		for _, peer := range []string{"203.0.113.4:5000", "10.0.0.2:5000"} {
			t.Run(header+"/"+peer, func(t *testing.T) {
				called := false
				e := echo.New()
				UseTrustedProxies(e, []string{"10.0.0.0/24"})
				e.GET("/", func(c echo.Context) error {
					called = true
					require.Equal(t, "http", c.Scheme())
					return c.NoContent(http.StatusOK)
				})
				req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "http://app.openpost.test/", nil)
				req.RemoteAddr = peer
				req.Header.Set(header, value)
				req.Header.Set("X-Forwarded-Proto", "malicious-proto")
				rec := httptest.NewRecorder()
				e.ServeHTTP(rec, req)
				require.True(t, called, "trusted proxy middleware must forward the request")
				require.Equal(t, http.StatusOK, rec.Code)
			})
		}
	}
}
