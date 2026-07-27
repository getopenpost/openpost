package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

type testAuthenticator struct{}

func (testAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	if token != "web-token" {
		return nil, apitokens.ErrInvalidToken
	}
	return &middleware.Principal{UserID: "user-1", Email: "user@example.com"}, nil
}

func newCLIAuthTestServer(t *testing.T) *cliAuthTestServer {
	t.Helper()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.APIToken)(nil), (*models.CLIAuthSession)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	tokenService := apitokens.NewService(db)
	handler := NewCLIAuthHandler(cliauth.NewService(db, tokenService), testAuthenticator{}, "https://openpost.test")
	handler.RegisterRoutes(api)

	return &cliAuthTestServer{echo: e, db: db}
}

func TestCLIAuthHappyPathReturnsTokenOnFirstApprovedPollOnly(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)

	require.NotEmpty(t, start.DeviceCode)
	require.Regexp(t, `^[A-Z2-9]{4}-[A-Z2-9]{4}$`, start.UserCode)
	require.Equal(t, "https://openpost.test/cli/authorize?user_code="+start.UserCode, start.VerificationURL)
	require.NotContains(t, start.VerificationURL, start.DeviceCode)

	session := srv.getSession(t, start.UserCode)
	require.Equal(t, "OpenPost CLI", session.ClientName)
	require.Equal(t, "1.2.3", session.ClientVersion)
	require.Equal(t, "linux/amd64", session.ClientOS)
	require.Equal(t, "cli:full", session.RequestedScopes)

	approveResp := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode,
	}, "web-token")
	require.Equal(t, http.StatusOK, approveResp.Code)

	firstPoll := srv.pollCLIAuth(t, start.DeviceCode)
	require.Equal(t, "approved", firstPoll.Status)
	require.True(t, strings.HasPrefix(firstPoll.Token, "op_cli_"))

	tokenCount, err := srv.db.NewSelect().
		Model((*models.APIToken)(nil)).
		Where("user_id = ?", "user-1").
		Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, tokenCount)

	srv.allowImmediatePoll(t)
	secondPollResp := srv.request(t, http.MethodPost, "/api/v1/cli/auth/poll", map[string]string{
		"device_code": start.DeviceCode,
	}, "")
	require.Equal(t, http.StatusOK, secondPollResp.Code)
	var secondPoll pollResponse
	require.NoError(t, json.Unmarshal(secondPollResp.Body.Bytes(), &secondPoll))
	require.Empty(t, secondPoll.Token)
	require.Equal(t, "expired_token", secondPoll.Status)
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

func TestCLIAuthPollIntervalEnforced(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)

	first := srv.pollCLIAuth(t, start.DeviceCode)
	require.Equal(t, "authorization_pending", first.Status)

	resp := srv.request(t, http.MethodPost, "/api/v1/cli/auth/poll", map[string]string{
		"device_code": start.DeviceCode,
	}, "")
	require.Equal(t, http.StatusTooManyRequests, resp.Code)
}

func TestCLIAuthStartRateLimit(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	var resp *httptest.ResponseRecorder
	for range 21 {
		resp = srv.request(t, http.MethodPost, "/api/v1/cli/auth/start", startRequest(), "")
	}
	require.Equal(t, http.StatusTooManyRequests, resp.Code)
}

func TestCLIAuthStartStoresOnlyHashes(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)

	var session models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&session).Scan(context.Background()))
	require.NotEqual(t, start.DeviceCode, session.DeviceCodeHash)
	require.NotEqual(t, start.UserCode, session.UserCodeHash)
	require.Len(t, session.DeviceCodeHash, 64)
	require.Len(t, session.UserCodeHash, 64)
	require.NotContains(t, start.VerificationURL, start.DeviceCode)
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

func (s *cliAuthTestServer) allowImmediatePoll(t *testing.T) {
	t.Helper()
	_, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("last_polled_at = ?", time.Now().UTC().Add(-2*time.Second)).
		Where("last_polled_at IS NOT NULL").
		Exec(context.Background())
	require.NoError(t, err)
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
