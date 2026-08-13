package mcpoauth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestCreateAndExchangeCodeWithClientMetadata(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newMCPOAuthTestDB(t)
	seedMCPOAuthUser(ctx, t, db)
	seedMCPOAuthWorkspace(ctx, t, db, "ws-1", "user-1")
	redirectURI := "https://chatgpt.com/connector/oauth/callback/openpost"
	client := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/client.json", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{
			"client_name":"ChatGPT OpenPost",
			"redirect_uris":["%s"],
			"token_endpoint_auth_method":"none",
			"grant_types":["authorization_code"],
			"response_types":["code"],
			"scope":"mcp:read"
		}`, redirectURI)
	}))
	t.Cleanup(client.Close)

	verifier := strings.Repeat("a", 43)
	service := NewService(db, apitokens.NewService(db))
	service.SetHTTPClient(client.Client())
	created, err := service.CreateAuthorizationCode(ctx, AuthorizationRequest{
		UserID:              "user-1",
		WorkspaceID:         "ws-1",
		ResponseType:        "code",
		ClientID:            client.URL + "/client.json",
		RedirectURI:         redirectURI,
		Scope:               "mcp:read",
		State:               "state-1",
		CodeChallenge:       pkceChallenge(verifier),
		CodeChallengeMethod: CodeChallengeMethodS256,
		Resource:            "https://app.openpost.test/mcp",
		ExpectedResource:    "https://app.openpost.test/mcp",
	})
	require.NoError(t, err)
	require.NotEmpty(t, created.Code)

	redirect, err := url.Parse(created.RedirectURL)
	require.NoError(t, err)
	require.Equal(t, redirectURI, redirect.Scheme+"://"+redirect.Host+redirect.Path)
	require.Equal(t, "state-1", redirect.Query().Get("state"))
	require.Equal(t, "https://app.openpost.test", redirect.Query().Get("iss"))
	require.NotEmpty(t, redirect.Query().Get("code"))

	var storedCode models.MCPOAuthCode
	require.NoError(t, db.NewSelect().Model(&storedCode).Scan(ctx))
	require.Equal(t, "ChatGPT OpenPost", storedCode.ClientName)
	require.Equal(t, "ws-1", storedCode.WorkspaceID)
	require.NotEqual(t, created.Code, storedCode.CodeHash)
	require.Len(t, storedCode.CodeHash, 64)

	exchanged, err := service.ExchangeCode(ctx, TokenRequest{
		GrantType:    "authorization_code",
		Code:         created.Code,
		RedirectURI:  redirectURI,
		ClientID:     client.URL + "/client.json",
		CodeVerifier: verifier,
		Resource:     "https://app.openpost.test/mcp",
	})
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(exchanged.AccessToken, "op_cli_"))
	require.Equal(t, "mcp:read", exchanged.Scope)
	require.Equal(t, "https://app.openpost.test/mcp", exchanged.Resource)

	principal, err := apitokens.NewService(db).ValidateToken(ctx, exchanged.AccessToken)
	require.NoError(t, err)
	require.Equal(t, "mcp:read", principal.Scope)
	require.Equal(t, "https://app.openpost.test/mcp", principal.Audience)
	require.Equal(t, "ws-1", principal.WorkspaceID)
	require.Equal(t, "ChatGPT OpenPost", principal.TokenName)
	require.Equal(t, client.URL+"/client.json", principal.ClientID)

	_, err = service.ExchangeCode(ctx, TokenRequest{
		GrantType:    "authorization_code",
		Code:         created.Code,
		RedirectURI:  redirectURI,
		ClientID:     client.URL + "/client.json",
		CodeVerifier: verifier,
		Resource:     "https://app.openpost.test/mcp",
	})
	require.ErrorIs(t, err, ErrInvalidGrant)
}

func TestNormalizeScopeSupportsReadOnlyAndFullMCPAccess(t *testing.T) {
	t.Parallel()

	readOnly, err := normalizeScope(apitokens.ScopeMCPRead)
	require.NoError(t, err)
	require.Equal(t, apitokens.ScopeMCPRead, readOnly)

	full, err := normalizeScope(apitokens.ScopeMCP)
	require.NoError(t, err)
	require.Equal(t, apitokens.ScopeMCP, full)

	_, err = normalizeScope(apitokens.ScopeMCPRead + " " + apitokens.ScopeMCP)
	require.ErrorIs(t, err, ErrUnsupportedScope)

	require.True(t, clientMetadataAllowsScope("mcp:read mcp:full", apitokens.ScopeMCPRead))
	require.True(t, clientMetadataAllowsScope("mcp:read mcp:full", apitokens.ScopeMCP))
	require.False(t, clientMetadataAllowsScope("mcp:full", apitokens.ScopeMCPRead))
	require.False(t, clientMetadataAllowsScope("mcp:read profile", apitokens.ScopeMCPRead))
}

func TestCreateAuthorizationCodeRejectsInaccessibleWorkspaceScope(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newMCPOAuthTestDB(t)
	seedMCPOAuthUser(ctx, t, db)

	_, err := NewService(db, apitokens.NewService(db)).CreateAuthorizationCode(ctx, AuthorizationRequest{
		UserID:              "user-1",
		WorkspaceID:         "ws-missing",
		ResponseType:        "code",
		ClientID:            "chatgpt",
		RedirectURI:         "https://chatgpt.com/connector/oauth/callback/openpost",
		CodeChallenge:       pkceChallenge(strings.Repeat("e", 43)),
		CodeChallengeMethod: CodeChallengeMethodS256,
		ExpectedResource:    "https://app.openpost.test/mcp",
	})
	require.ErrorIs(t, err, ErrWorkspaceNotAllowed)
}

func TestCreateAuthorizationCodeRejectsRedirectOutsideClientMetadata(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newMCPOAuthTestDB(t)
	seedMCPOAuthUser(ctx, t, db)
	client := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"redirect_uris":["https://chatgpt.com/connector/oauth/callback/openpost"],"token_endpoint_auth_method":"none"}`))
	}))
	t.Cleanup(client.Close)

	service := NewService(db, apitokens.NewService(db))
	service.SetHTTPClient(client.Client())
	_, err := service.CreateAuthorizationCode(ctx, AuthorizationRequest{
		UserID:              "user-1",
		ResponseType:        "code",
		ClientID:            client.URL,
		RedirectURI:         "https://evil.example/callback",
		CodeChallenge:       pkceChallenge(strings.Repeat("b", 43)),
		CodeChallengeMethod: CodeChallengeMethodS256,
		ExpectedResource:    "https://app.openpost.test/mcp",
	})
	require.ErrorIs(t, err, ErrInvalidClient)
}

func TestClientMetadataRejectsHTTPAndPrivateNetworks(t *testing.T) {
	t.Parallel()

	_, err := validateClientMetadataURL("http://client.example/metadata.json")
	require.ErrorIs(t, err, ErrInvalidClient)

	service := NewService(nil, nil)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://127.0.0.1/client.json", nil)
	require.NoError(t, err)
	resp, err := service.httpClient.Do(req)
	if resp != nil {
		defer resp.Body.Close()
	}
	require.Error(t, err)
	require.Contains(t, err.Error(), "private or local address")
}

func TestExchangeCodeRejectsWrongVerifierAndResource(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := newMCPOAuthTestDB(t)
	seedMCPOAuthUser(ctx, t, db)
	verifier := strings.Repeat("c", 43)
	service := NewService(db, apitokens.NewService(db))
	created, err := service.CreateAuthorizationCode(ctx, AuthorizationRequest{
		UserID:              "user-1",
		ResponseType:        "code",
		ClientID:            "chatgpt",
		RedirectURI:         "https://chatgpt.com/connector/oauth/callback/openpost",
		CodeChallenge:       pkceChallenge(verifier),
		CodeChallengeMethod: CodeChallengeMethodS256,
		ExpectedResource:    "https://app.openpost.test/mcp",
	})
	require.NoError(t, err)

	_, err = service.ExchangeCode(ctx, TokenRequest{
		GrantType:    "authorization_code",
		Code:         created.Code,
		RedirectURI:  "https://chatgpt.com/connector/oauth/callback/openpost",
		ClientID:     "chatgpt",
		CodeVerifier: strings.Repeat("d", 43),
	})
	require.ErrorIs(t, err, ErrInvalidGrant)

	_, err = service.ExchangeCode(ctx, TokenRequest{
		GrantType:    "authorization_code",
		Code:         created.Code,
		RedirectURI:  "https://chatgpt.com/connector/oauth/callback/openpost",
		ClientID:     "chatgpt",
		CodeVerifier: verifier,
		Resource:     "https://other.example/mcp",
	})
	require.ErrorIs(t, err, ErrUnsupportedResource)
}

func newMCPOAuthTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
		(*models.MCPOAuthCode)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return db
}

func seedMCPOAuthWorkspace(ctx context.Context, t *testing.T, db *bun.DB, workspaceID, userID string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.Workspace{
		ID:   workspaceID,
		Name: "Workspace",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
}

func seedMCPOAuthUser(ctx context.Context, t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
