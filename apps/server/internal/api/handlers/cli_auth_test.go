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
	"github.com/openpost/backend/internal/services/apitokens"
	cliauth "github.com/openpost/backend/internal/services/cli_auth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type cliAuthTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

type cliAuthBrowserAuthenticator struct{}

func (cliAuthBrowserAuthenticator) AuthenticateBearer(
	_ context.Context,
	token string,
) (*middleware.Principal, error) {
	if token != "web-token" {
		return nil, apitokens.ErrInvalidToken
	}
	return &middleware.Principal{
		UserID:    "user-1",
		Email:     "user@example.com",
		SessionID: "session-1",
	}, nil
}

type cliAuthTokenAuthenticator struct{}

func (cliAuthTokenAuthenticator) AuthenticateBearer(
	_ context.Context,
	_ string,
) (*middleware.Principal, error) {
	return &middleware.Principal{
		UserID:      "user-1",
		Email:       "user@example.com",
		Scope:       apitokens.ScopeCLI,
		WorkspaceID: "workspace-1",
		TokenID:     "bound-cli-token",
	}, nil
}

type testAuthenticator struct{}

func (testAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	if token == "other-workspace-token" {
		return &middleware.Principal{UserID: "user-1", Email: "user@example.com", WorkspaceID: "ws-2", TokenID: "other-workspace-token", ClientID: "test-client"}, nil
	}
	if token != "web-token" {
		return nil, apitokens.ErrInvalidToken
	}
	return &middleware.Principal{UserID: "user-1", Email: "user@example.com"}, nil
}

func newCLIAuthTestServer(t *testing.T) *cliAuthTestServer {
	return newCLIAuthTestServerWithAuthenticator(t, cliAuthBrowserAuthenticator{})
}

func newCLIAuthTestServerWithAuthenticator(
	t *testing.T,
	authenticator middleware.Authenticator,
) *cliAuthTestServer {
	t.Helper()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
		(*models.CLIAuthSession)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	tokenService := apitokens.NewService(db)
	handler := NewCLIAuthHandler(cliauth.NewService(db, tokenService), authenticator, "https://openpost.test")
	handler.RegisterRoutes(api)

	return &cliAuthTestServer{echo: e, db: db}
}

func TestCLIAuthDecisionRejectsAPITokenPrincipal(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServerWithAuthenticator(t, cliAuthTokenAuthenticator{})
	start := srv.startCLIAuth(t)

	details := srv.request(
		t,
		http.MethodGet,
		"/api/v1/cli/auth/session?user_code="+start.UserCode,
		nil,
		"web-token",
	)
	require.Equal(t, http.StatusForbidden, details.Code, details.Body.String())

	for _, path := range []string{"/api/v1/cli/auth/approve", "/api/v1/cli/auth/deny"} {
		decision := srv.request(t, http.MethodPost, path, map[string]string{
			"user_code": start.UserCode,
		}, "web-token")
		require.Equal(t, http.StatusForbidden, decision.Code, decision.Body.String())
	}

	var sessions []models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&sessions).Order("created_at ASC").Scan(t.Context()))
	require.Len(t, sessions, 1)
	require.Equal(t, "pending", sessions[0].Status)
}

func TestCLIAuthApprovedSessionCannotMintAfterDeviceAuthorizationExpires(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)
	approve := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode,
	}, "web-token")
	require.Equal(t, http.StatusOK, approve.Code, approve.Body.String())
	_, err := srv.db.NewUpdate().Model((*models.CLIAuthSession)(nil)).
		Set("expires_at = ?", time.Now().UTC().Add(-time.Minute)).
		Where("device_code_hash != ''").
		Exec(t.Context())
	require.NoError(t, err)

	poll := srv.request(t, http.MethodPost, "/api/v1/cli/auth/poll", map[string]string{
		"device_code": start.DeviceCode,
	}, "")
	require.Equal(t, http.StatusBadRequest, poll.Code, poll.Body.String())
	require.Contains(t, poll.Body.String(), "expired_token")
	tokenCount, err := srv.db.NewSelect().Model((*models.APIToken)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, tokenCount)
	var session models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&session).Where("device_code_hash != ''").Scan(t.Context()))
	require.Equal(t, "expired", session.Status)
}

func TestCLIAuthBindsApprovalToOneNormalizedRequestedScope(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	for _, requestedScopes := range []string{"unknown:scope", "api:read", "cli:full,api:read", "cli:full api:read"} {
		request := startRequest()
		request["requested_scopes"] = requestedScopes
		response := srv.request(t, http.MethodPost, "/api/v1/cli/auth/start", request, "")
		require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	}

	request := startRequest()
	request["requested_scopes"] = "  cli:full  "
	startResponseRecorder := srv.request(t, http.MethodPost, "/api/v1/cli/auth/start", request, "")
	require.Equal(t, http.StatusOK, startResponseRecorder.Code, startResponseRecorder.Body.String())
	var start startResponse
	require.NoError(t, json.Unmarshal(startResponseRecorder.Body.Bytes(), &start))
	require.Equal(t, "cli:full", srv.getSession(t, start.UserCode).RequestedScopes)

	override := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode,
		"scopes":    "api:read",
	}, "web-token")
	require.Equal(t, http.StatusBadRequest, override.Code, override.Body.String())
	var pending models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&pending).
		Where("user_code_hash != '' AND status = ?", "pending").Scan(t.Context()))
	require.Equal(t, "cli:full", pending.RequestedScopes)

	approved := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode,
	}, "web-token")
	require.Equal(t, http.StatusOK, approved.Code, approved.Body.String())
	poll := srv.pollCLIAuth(t, start.DeviceCode)
	require.NotEmpty(t, poll.Token)
	var token models.APIToken
	require.NoError(t, srv.db.NewSelect().Model(&token).Where("user_id = ?", "user-1").Scan(t.Context()))
	require.Equal(t, "cli:full", token.Scope)
}

func TestCLIAuthDefaultsOmittedRequestedScope(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	request := startRequest()
	delete(request, "requested_scopes")

	response := srv.request(t, http.MethodPost, "/api/v1/cli/auth/start", request, "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var start startResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &start))
	require.Equal(t, "cli:full", srv.getSession(t, start.UserCode).RequestedScopes)
}

func TestCLIAuthDenyFlow(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)

	denyResp := srv.request(t, http.MethodPost, "/api/v1/cli/auth/deny", map[string]string{
		"user_code": start.UserCode,
	}, "web-token")
	require.Equal(t, http.StatusOK, denyResp.Code)

	poll := srv.pollCLIAuth(t, start.DeviceCode)
	require.Equal(t, "access_denied", poll.Status)
	require.Empty(t, poll.Token)
}

func TestCLIAuthExpiry(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)
	_, err := srv.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("expires_at = ?", time.Now().UTC().Add(-time.Minute)).
		Where("device_code_hash != ''").
		Exec(context.Background())
	require.NoError(t, err)

	poll := srv.pollCLIAuth(t, start.DeviceCode)
	require.Equal(t, "expired_token", poll.Status)
	require.Empty(t, poll.Token)
}

func TestCLIAuthStartExpiresOlderPendingSessions(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	now := time.Now().UTC()
	for _, session := range []*models.CLIAuthSession{
		{
			ID: "expired-pending", DeviceCodeHash: "expired-device", UserCodeHash: "expired-user",
			ClientName: "Old CLI", RequestedScopes: "cli:full", Status: "pending",
			IntervalSeconds: 5, ExpiresAt: now.Add(-time.Minute), CreatedAt: now.Add(-time.Hour),
		},
		{
			ID: "future-pending", DeviceCodeHash: "future-device", UserCodeHash: "future-user",
			ClientName: "Current CLI", RequestedScopes: "cli:full", Status: "pending",
			IntervalSeconds: 5, ExpiresAt: now.Add(time.Hour), CreatedAt: now,
		},
	} {
		_, err := srv.db.NewInsert().Model(session).Exec(t.Context())
		require.NoError(t, err)
	}

	srv.startCLIAuth(t)

	var sessions []models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&sessions).
		Where("id IN (?, ?)", "expired-pending", "future-pending").
		Order("id ASC").Scan(t.Context()))
	require.Len(t, sessions, 2)
	require.Equal(t, "expired", sessions[0].Status)
	require.Equal(t, "pending", sessions[1].Status)
}

type startResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURL string `json:"verification_url"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

type sessionResponse struct {
	ClientName      string `json:"client_name"`
	ClientVersion   string `json:"client_version"`
	ClientOS        string `json:"client_os"`
	RequestedScopes string `json:"requested_scopes"`
}

type pollResponse struct {
	Status    string `json:"status"`
	Token     string `json:"token"`
	ExpiresIn int    `json:"expires_in"`
	Interval  int    `json:"interval"`
}

func (s *cliAuthTestServer) startCLIAuth(t *testing.T) startResponse {
	t.Helper()
	resp := s.request(t, http.MethodPost, "/api/v1/cli/auth/start", startRequest(), "")
	require.Equal(t, http.StatusOK, resp.Code)
	var out startResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	return out
}

func (s *cliAuthTestServer) getSession(t *testing.T, userCode string) sessionResponse {
	t.Helper()
	resp := s.request(t, http.MethodGet, "/api/v1/cli/auth/session?user_code="+userCode, nil, "web-token")
	require.Equal(t, http.StatusOK, resp.Code)
	var out sessionResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	return out
}

func (s *cliAuthTestServer) pollCLIAuth(t *testing.T, deviceCode string) pollResponse {
	t.Helper()
	resp := s.request(t, http.MethodPost, "/api/v1/cli/auth/poll", map[string]string{
		"device_code": deviceCode,
	}, "")
	require.Equal(t, http.StatusOK, resp.Code)
	var out pollResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	return out
}

func (s *cliAuthTestServer) request(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "203.0.113.10:12345"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func startRequest() map[string]string {
	return map[string]string{
		"client_name":      "OpenPost CLI",
		"client_version":   "1.2.3",
		"client_os":        "linux/amd64",
		"requested_scopes": "cli:full",
	}
}
