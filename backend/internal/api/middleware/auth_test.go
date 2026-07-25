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

	"github.com/labstack/echo/v4"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
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

func newEchoAuthed(auth Authenticator) *echo.Echo {
	e := echo.New()
	e.GET("/x", func(c echo.Context) error {
		return c.NoContent(http.StatusOK)
	}, BearerMiddleware(auth))
	return e
}

func TestBearerMiddleware_Success_AttachesPrincipal(t *testing.T) {
	want := &Principal{UserID: "u_42", Email: "rodrigo@example.com"}
	auth := &fakeAuthenticator{principal: want}

	e := newEchoAuthed(auth)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer op_cli_abc_secret")
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if auth.gotToken != "op_cli_abc_secret" {
		t.Errorf("middleware did not pass raw token to authenticator, got %q", auth.gotToken)
	}
}

func TestBearerMiddleware_MissingHeader(t *testing.T) {
	auth := &fakeAuthenticator{principal: &Principal{UserID: "u"}}
	e := newEchoAuthed(auth)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing header, got %d", rec.Code)
	}
	if auth.gotToken != "" {
		t.Errorf("authenticator should not be called on missing header, got token %q", auth.gotToken)
	}
}

func TestBearerMiddleware_BadFormat(t *testing.T) {
	auth := &fakeAuthenticator{principal: &Principal{UserID: "u"}}
	e := newEchoAuthed(auth)

	for _, h := range []string{"op_cli_abc", "Basic abc123", "Bearer"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
		req.Header.Set("Authorization", h)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for header %q, got %d", h, rec.Code)
		}
	}
}

func TestBearerMiddleware_InvalidToken_Returns401(t *testing.T) {
	// The media upload 401 the user hit: a valid Bearer header whose
	// token the authenticator rejects. This is the regression guard.
	auth := &fakeAuthenticator{err: errors.New("not found")}
	e := newEchoAuthed(auth)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer op_cli_bogus")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for rejected token, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestBearerMiddlewareRejectsMCPResourceToken(t *testing.T) {
	auth := &fakeAuthenticator{principal: &Principal{
		UserID:   "u",
		Scope:    apitokens.ScopeMCP,
		Audience: "https://app.openpost.test/mcp",
	}}
	e := newEchoAuthed(auth)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer op_cli_mcp_secret")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), "not authorized")
}

func TestPrincipalCanAccessREST(t *testing.T) {
	require.True(t, principalCanAccessREST(&Principal{Scope: apitokens.ScopeCLI}))
	require.True(t, principalCanAccessREST(&Principal{}))
	require.False(t, principalCanAccessREST(&Principal{Scope: apitokens.ScopeMCP}))
	require.False(t, principalCanAccessREST(&Principal{Scope: apitokens.ScopeCLI, Audience: "https://example.test/mcp"}))
}

func TestRequestAuthTokenAcceptsSessionCookie(t *testing.T) {
	token, cookieAuth := requestAuthToken("", "theme=dark; openpost_session=session-token")
	require.Equal(t, "session-token", token)
	require.True(t, cookieAuth)
}

func TestCookieRequestOriginProtection(t *testing.T) {
	require.True(t, cookieRequestAllowed(http.MethodGet, "", "app.openpost.test"))
	require.True(t, cookieRequestAllowed(http.MethodPost, "https://app.openpost.test", "app.openpost.test"))
	require.True(t, cookieRequestAllowed(http.MethodPost, "http://localhost:5173", "localhost:8080"))
	require.False(t, cookieRequestAllowed(http.MethodPost, "https://evil.example", "app.openpost.test"))
	require.False(t, cookieRequestAllowed(http.MethodPost, "", "app.openpost.test"))
}

type rejectingAuthenticator struct{}

func (rejectingAuthenticator) AuthenticateBearer(_ context.Context, _ string) (*Principal, error) {
	return nil, errors.New("invalid jwt")
}

func TestCompositeServicePreservesAPITokenScope(t *testing.T) {
	ctx := context.Background()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
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
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
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

func TestCheckWorkspaceAccessHonorsTokenWorkspaceScope(t *testing.T) {
	ctx := context.Background()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
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
	} {
		if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash"}).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.NewInsert().Model(&[]models.Workspace{
		{ID: "ws-1", Name: "Launch"},
		{ID: "ws-2", Name: "Personal"},
		{ID: "ws-3", Name: "Editorial"},
	}).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.NewInsert().Model(&[]models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "ws-2", UserID: "user-1", Role: models.WorkspaceRoleViewer},
		{WorkspaceID: "ws-3", UserID: "user-1", Role: models.WorkspaceRoleEditor},
	}).Exec(ctx); err != nil {
		t.Fatal(err)
	}

	ok, err := CheckWorkspaceEditAccess(ctx, db, "ws-1", "user-1")
	if err != nil || !ok {
		t.Fatalf("expected admin edit access, ok=%v err=%v", ok, err)
	}
	ok, err = CheckWorkspaceAdminAccess(ctx, db, "ws-1", "user-1")
	if err != nil || !ok {
		t.Fatalf("expected admin configuration access, ok=%v err=%v", ok, err)
	}
	ok, err = CheckWorkspaceEditAccess(ctx, db, "ws-2", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected viewer edit access to be rejected")
	}
	ok, err = CheckWorkspaceEditAccess(ctx, db, "ws-3", "user-1")
	if err != nil || !ok {
		t.Fatalf("expected editor edit access, ok=%v err=%v", ok, err)
	}
	ok, err = CheckWorkspaceAdminAccess(ctx, db, "ws-3", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected editor configuration access to be rejected")
	}

	scopedCtx := context.WithValue(ctx, WorkspaceIDKey, "ws-1")
	ok, err = CheckWorkspaceAccess(scopedCtx, db, "ws-1", "user-1")
	if err != nil || !ok {
		t.Fatalf("expected scoped workspace access, ok=%v err=%v", ok, err)
	}
	ok, err = CheckWorkspaceAccess(scopedCtx, db, "ws-2", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected workspace scope to reject ws-2")
	}
	ok, err = CheckWorkspaceEditAccess(scopedCtx, db, "ws-3", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected workspace scope to reject editor access outside ws-1")
	}
}
