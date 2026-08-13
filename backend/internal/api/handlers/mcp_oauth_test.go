package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/mcpoauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type mcpOAuthTestServer struct {
	echo      *echo.Echo
	db        *bun.DB
	apiTokens *apitokens.Service
	oauth     *mcpoauth.Service
}

type mcpOAuthTestAuthenticator struct {
	tokens *apitokens.Service
}

func (a mcpOAuthTestAuthenticator) AuthenticateBearer(ctx context.Context, token string) (*middleware.Principal, error) {
	if token == "web-token" {
		return &middleware.Principal{
			UserID:    "user-1",
			Email:     "user@example.com",
			SessionID: "session-1",
		}, nil
	}
	principal, err := a.tokens.ValidateToken(ctx, token)
	if err != nil {
		return nil, err
	}
	return &middleware.Principal{
		UserID:      principal.UserID,
		Email:       principal.Email,
		Scope:       principal.Scope,
		WorkspaceID: principal.WorkspaceID,
		Audience:    principal.Audience,
		ClientID:    principal.TokenID,
		ClientName:  principal.TokenName,
		TokenPrefix: principal.TokenPrefix,
		TokenID:     principal.TokenID,
	}, nil
}

func newMCPOAuthTestServer(t *testing.T) *mcpOAuthTestServer {
	t.Helper()

	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
		(*models.MCPOAuthCode)(nil),
		(*models.MCPToolCall)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{
		ID:        "ws-1",
		Name:      "Launch",
		CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	tokenService := apitokens.NewService(db)
	authenticator := mcpOAuthTestAuthenticator{tokens: tokenService}
	oauthService := mcpoauth.NewService(db, tokenService)
	NewMCPOAuthHandler(oauthService, authenticator, "https://app.openpost.test").RegisterRoutes(e, api)
	mcp := NewMCPHandler(db, authenticator)
	mcp.SetPublicURL("https://app.openpost.test")
	mcp.RegisterRoutes(e)

	return &mcpOAuthTestServer{echo: e, db: db, apiTokens: tokenService, oauth: oauthService}
}

func TestMCPOAuthAuthorizationCodeFlowIssuesUsableMCPToken(t *testing.T) {
	t.Parallel()

	srv := newMCPOAuthTestServer(t)
	redirectURI := "https://chatgpt.com/connector/oauth/callback/openpost"
	client := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"client_name":"ChatGPT OpenPost","redirect_uris":["%s"],"token_endpoint_auth_method":"none"}`, redirectURI)
	}))
	t.Cleanup(client.Close)
	srv.oauth.SetHTTPClient(client.Client())

	metadataResp := srv.request(t, http.MethodGet, "/.well-known/oauth-authorization-server", nil, "")
	require.Equal(t, http.StatusOK, metadataResp.Code)
	var metadata map[string]any
	require.NoError(t, json.Unmarshal(metadataResp.Body.Bytes(), &metadata))
	require.Equal(t, "https://app.openpost.test/oauth/authorize", metadata["authorization_endpoint"])
	require.Equal(t, "https://app.openpost.test/oauth/token", metadata["token_endpoint"])
	require.Equal(t, []any{"mcp:read", "mcp:full"}, metadata["scopes_supported"])
	require.Equal(t, true, metadata["client_id_metadata_document_supported"])

	verifier := strings.Repeat("e", 43)
	authorizeResp := srv.request(t, http.MethodPost, "/api/v1/mcp/oauth/authorize", map[string]any{
		"approved":              true,
		"workspace_id":          "ws-1",
		"response_type":         "code",
		"client_id":             client.URL,
		"redirect_uri":          redirectURI,
		"scope":                 "mcp:full",
		"state":                 "state-chatgpt",
		"code_challenge":        mcpOAuthPKCEChallenge(verifier),
		"code_challenge_method": "S256",
		"resource":              "https://app.openpost.test/mcp",
	}, "web-token")
	require.Equal(t, http.StatusOK, authorizeResp.Code, authorizeResp.Body.String())
	var authorization struct {
		RedirectURL string `json:"redirect_url"`
	}
	require.NoError(t, json.Unmarshal(authorizeResp.Body.Bytes(), &authorization))
	redirect, err := url.Parse(authorization.RedirectURL)
	require.NoError(t, err)
	require.Equal(t, redirectURI, redirect.Scheme+"://"+redirect.Host+redirect.Path)
	require.Equal(t, "state-chatgpt", redirect.Query().Get("state"))
	code := redirect.Query().Get("code")
	require.NotEmpty(t, code)

	tokenResp := srv.form(t, "/oauth/token", url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {client.URL},
		"code_verifier": {verifier},
		"resource":      {"https://app.openpost.test/mcp"},
	})
	require.Equal(t, http.StatusOK, tokenResp.Code, tokenResp.Body.String())
	var token struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
		Resource    string `json:"resource"`
	}
	require.NoError(t, json.Unmarshal(tokenResp.Body.Bytes(), &token))
	require.Equal(t, "Bearer", token.TokenType)
	require.Equal(t, "mcp:full", token.Scope)
	require.Equal(t, "https://app.openpost.test/mcp", token.Resource)

	initializeResp := srv.request(t, http.MethodPost, "/mcp", map[string]any{
		"jsonrpc": "2.0",
		"id":      "init",
		"method":  "initialize",
	}, token.AccessToken)
	require.Equal(t, http.StatusOK, initializeResp.Code, initializeResp.Body.String())

	var stored models.APIToken
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("token_prefix = ?", tokenPrefix(t, token.AccessToken)).Scan(context.Background()))
	require.Equal(t, "https://app.openpost.test/mcp", stored.Audience)
	require.Equal(t, "ws-1", stored.WorkspaceID)
	require.Equal(t, "ChatGPT OpenPost", stored.Name)
}

func TestMCPOAuthDenyReturnsAccessDeniedRedirect(t *testing.T) {
	t.Parallel()

	srv := newMCPOAuthTestServer(t)
	resp := srv.request(t, http.MethodPost, "/api/v1/mcp/oauth/authorize", map[string]any{
		"approved":      false,
		"response_type": "code",
		"client_id":     "chatgpt",
		"redirect_uri":  "https://chatgpt.com/connector/oauth/callback/openpost",
		"state":         "state-deny",
		"resource":      "https://app.openpost.test/mcp",
	}, "web-token")
	require.Equal(t, http.StatusOK, resp.Code)
	var authorization struct {
		RedirectURL string `json:"redirect_url"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &authorization))
	redirect, err := url.Parse(authorization.RedirectURL)
	require.NoError(t, err)
	require.Equal(t, "access_denied", redirect.Query().Get("error"))
	require.Equal(t, "state-deny", redirect.Query().Get("state"))
}

func TestMCPOAuthAuthorizationRejectsAPITokenPrincipal(t *testing.T) {
	t.Parallel()

	srv := newMCPOAuthTestServer(t)
	generated, err := srv.apiTokens.GenerateTokenWithOptions(
		t.Context(),
		"user-1",
		"Bound CLI",
		apitokens.ScopeCLI,
		apitokens.GenerateOptions{WorkspaceID: "ws-1"},
	)
	require.NoError(t, err)

	for _, approved := range []bool{false, true} {
		resp := srv.request(t, http.MethodPost, "/api/v1/mcp/oauth/authorize", map[string]any{
			"approved":      approved,
			"response_type": "code",
			"client_id":     "chatgpt",
			"redirect_uri":  "https://chatgpt.com/connector/oauth/callback/openpost",
			"workspace_id":  "",
			"resource":      "https://app.openpost.test/mcp",
		}, generated.Token)
		require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	}
}

func (s *mcpOAuthTestServer) request(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	req.Host = "app.openpost.test"
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *mcpOAuthTestServer) form(t *testing.T, path string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(form.Encode()))
	req.Host = "app.openpost.test"
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func mcpOAuthPKCEChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func tokenPrefix(t *testing.T, token string) string {
	t.Helper()
	parts := strings.SplitN(token, "_", 4)
	require.Len(t, parts, 4)
	return parts[2]
}
