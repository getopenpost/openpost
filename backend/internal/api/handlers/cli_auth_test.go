package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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

func TestCLIAuthApprovalBindsChosenWorkspaceAndRejectsInaccessibleWorkspace(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)
	approve := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode, "workspace_id": "workspace-1",
	}, "web-token")
	require.Equal(t, http.StatusOK, approve.Code, approve.Body.String())
	poll := srv.pollCLIAuth(t, start.DeviceCode)
	require.NotEmpty(t, poll.Token)
	var token models.APIToken
	require.NoError(t, srv.db.NewSelect().Model(&token).Where("user_id = ?", "user-1").Scan(t.Context()))
	require.Equal(t, "workspace-1", token.WorkspaceID)

	second := srv.startCLIAuth(t)
	rejected := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": second.UserCode, "workspace_id": "workspace-other",
	}, "web-token")
	require.Equal(t, http.StatusForbidden, rejected.Code, rejected.Body.String())
}

func TestCLIAuthApprovalWithoutWorkspaceCreatesAllWorkspaceToken(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)
	approve := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode,
	}, "web-token")
	require.Equal(t, http.StatusOK, approve.Code, approve.Body.String())
	poll := srv.pollCLIAuth(t, start.DeviceCode)
	require.NotEmpty(t, poll.Token)

	var token models.APIToken
	require.NoError(t, srv.db.NewSelect().Model(&token).Where("user_id = ?", "user-1").Scan(t.Context()))
	require.Empty(t, token.WorkspaceID)
	require.Empty(t, token.OrganizationID)
}

func TestCLIAuthRechecksWorkspaceAccessBeforeMintingToken(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	start := srv.startCLIAuth(t)
	approve := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode, "workspace_id": "workspace-1",
	}, "web-token")
	require.Equal(t, http.StatusOK, approve.Code, approve.Body.String())

	_, err := srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("status = ?", models.WorkspaceMemberStatusInactive).
		Set("deactivated_at = ?", time.Now().UTC()).
		Where("workspace_id = ? AND user_id = ?", "workspace-1", "user-1").
		Exec(t.Context())
	require.NoError(t, err)

	poll := srv.request(t, http.MethodPost, "/api/v1/cli/auth/poll", map[string]string{
		"device_code": start.DeviceCode,
	}, "")
	require.Equal(t, http.StatusForbidden, poll.Code, poll.Body.String())
	tokenCount, err := srv.db.NewSelect().Model((*models.APIToken)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, tokenCount)
	var session models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&session).
		Where("device_code_hash != ''").Scan(t.Context()))
	require.Equal(t, "expired", session.Status)
}

func TestCLIAuthConcurrentApprovedPollsMintExactlyOneToken(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	// A single SQLite connection gives both requests deterministic transaction
	// ordering while they still race after observing the approved session.
	srv.db.SetMaxOpenConns(1)
	start := srv.startCLIAuth(t)
	approve := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": start.UserCode,
	}, "web-token")
	require.Equal(t, http.StatusOK, approve.Code, approve.Body.String())

	responses := make(chan *httptest.ResponseRecorder, 2)
	ready := sync.WaitGroup{}
	ready.Add(2)
	startPolls := make(chan struct{})
	for range 2 {
		go func() {
			ready.Done()
			<-startPolls
			responses <- srv.request(t, http.MethodPost, "/api/v1/cli/auth/poll", map[string]string{
				"device_code": start.DeviceCode,
			}, "")
		}()
	}
	ready.Wait()
	close(startPolls)

	secretCount := 0
	for range 2 {
		response := <-responses
		var body pollResponse
		if response.Code == http.StatusOK {
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		}
		if body.Token != "" {
			secretCount++
			require.Equal(t, "approved", body.Status)
		}
	}
	require.Equal(t, 1, secretCount)
	tokenCount, err := srv.db.NewSelect().Model((*models.APIToken)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, tokenCount)
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

func TestCLIAuthConcurrentApprovalAndDenialChooseOneTerminalState(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	srv.db.SetMaxOpenConns(1)
	start := srv.startCLIAuth(t)
	responses := make(chan *httptest.ResponseRecorder, 2)
	ready := sync.WaitGroup{}
	ready.Add(2)
	begin := make(chan struct{})
	go func() {
		ready.Done()
		<-begin
		responses <- srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
			"user_code": start.UserCode,
		}, "web-token")
	}()
	go func() {
		ready.Done()
		<-begin
		responses <- srv.request(t, http.MethodPost, "/api/v1/cli/auth/deny", map[string]string{
			"user_code": start.UserCode,
		}, "web-token")
	}()
	ready.Wait()
	close(begin)

	successes := 0
	conflicts := 0
	for range 2 {
		response := <-responses
		switch response.Code {
		case http.StatusOK:
			successes++
		case http.StatusConflict:
			conflicts++
		default:
			require.Failf(t, "unexpected decision response", "status=%d body=%s", response.Code, response.Body.String())
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, conflicts)

	var session models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&session).Where("device_code_hash != ''").Scan(t.Context()))
	require.Contains(t, []string{"approved", "denied"}, session.Status)
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
	var storedToken models.APIToken
	require.NoError(t, srv.db.NewSelect().Model(&storedToken).Where("user_id = ?", "user-1").Scan(context.Background()))
	require.Equal(t, cliauth.ClientID, storedToken.ClientID)

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

func TestCLIAuthTokenNamesUseCharacterLengthAndFailBeforeApproval(t *testing.T) {
	t.Parallel()

	srv := newCLIAuthTestServer(t)
	validName := strings.Repeat("é", apitokens.MaximumNameLength)
	request := startRequest()
	request["client_name"] = validName
	valid := srv.request(t, http.MethodPost, "/api/v1/cli/auth/start", request, "")
	require.Equal(t, http.StatusOK, valid.Code, valid.Body.String())
	var started startResponse
	require.NoError(t, json.Unmarshal(valid.Body.Bytes(), &started))

	request["client_name"] += "é"
	tooLong := srv.request(t, http.MethodPost, "/api/v1/cli/auth/start", request, "")
	require.Equal(t, http.StatusUnprocessableEntity, tooLong.Code, tooLong.Body.String())

	var session models.CLIAuthSession
	require.NoError(t, srv.db.NewSelect().Model(&session).Where("client_name = ?", validName).Scan(t.Context()))
	_, err := srv.db.NewUpdate().Model((*models.CLIAuthSession)(nil)).
		Set("client_name = ?", validName+"é").
		Where("id = ?", session.ID).
		Exec(t.Context())
	require.NoError(t, err)
	approve := srv.request(t, http.MethodPost, "/api/v1/cli/auth/approve", map[string]string{
		"user_code": started.UserCode,
	}, "web-token")
	require.Equal(t, http.StatusBadRequest, approve.Code, approve.Body.String())
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
