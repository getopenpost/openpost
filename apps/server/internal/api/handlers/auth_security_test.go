package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/mfa"
	"github.com/stretchr/testify/require"
)

func TestPasskeyLoginAttemptLimit(t *testing.T) {
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.AuthChallenge)(nil), (*models.UserPasskey)(nil))
	user := &models.User{ID: "u", Email: "u@example.com", PasswordHash: "unused", CreatedAt: time.Now().UTC()}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	payload, _ := json.Marshal(loginChallengePayload{Methods: []string{mfaMethodPasskey}})
	challenge := &models.AuthChallenge{ID: "mfa", UserID: "u", Type: authChallengeLoginMFA, Payload: string(payload), ExpiresAt: time.Now().Add(time.Minute), CreatedAt: time.Now()}
	_, err = db.NewInsert().Model(challenge).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("test", "1"))
	handler := NewAuthHandler(db, nil, nil, nil, nil, false)
	handler.BeginPasskeyLogin(api)
	for i := 0; i < 11; i++ {
		resp := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/login/passkey/options", map[string]any{"mfa_token": "mfa"}, "")
		if i < 10 {
			require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
		} else {
			require.Equal(t, http.StatusTooManyRequests, resp.Code, resp.Body.String())
		}
	}
}

func TestBrowserAuthResponseHasOnlyCookie(t *testing.T) {
	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	user := &models.User{ID: "u", Email: "u@example.com", PasswordHash: "unused", CreatedAt: time.Now().UTC()}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	browserCtx := context.WithValue(t.Context(), middleware.OriginKey, "https://app.openpost.test")
	out, err := handler.issueAuthResponse(browserCtx, user)
	require.NoError(t, err)
	require.Empty(t, out.Body.Token)
	require.Contains(t, out.SetCookie, "HttpOnly")
	native, err := handler.issueAuthResponse(t.Context(), user)
	require.NoError(t, err)
	require.NotEmpty(t, native.Body.Token)
}

func TestPasskeyBeginRetryKeepsSameCeremony(t *testing.T) {
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.AuthChallenge)(nil), (*models.UserPasskey)(nil))
	user := &models.User{ID: "u", Email: "u@example.com", PasswordHash: "unused", CreatedAt: time.Now().UTC()}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.UserPasskey{ID: "key", UserID: "u", CredentialID: []byte{1, 2, 3}, CredentialJSON: `{"id":"AQID","publicKey":"AQID"}`, CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	challenge := &models.AuthChallenge{ID: "mfa", UserID: "u", Type: authChallengeLoginMFA, Payload: `{"methods":["passkey"]}`, ExpiresAt: time.Now().Add(time.Minute), CreatedAt: time.Now()}
	_, err = db.NewInsert().Model(challenge).Exec(t.Context())
	require.NoError(t, err)
	service, err := mfa.NewService("OpenPost", mfa.RelyingPartyConfig{Name: "OpenPost", ID: "localhost", Origins: []string{"http://localhost"}})
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("test", "1"))
	handler := NewAuthHandler(db, nil, nil, nil, service, false)
	handler.BeginPasskeyLogin(api)
	var first json.RawMessage
	for i := 0; i < 2; i++ {
		response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/login/passkey/options", map[string]any{"mfa_token": "mfa"}, "")
		require.Equal(t, 200, response.Code, response.Body.String())
		if i == 0 {
			first = response.Body.Bytes()
		} else {
			require.JSONEq(t, string(first), response.Body.String())
		}
	}
	count, err := db.NewSelect().Model((*models.AuthChallenge)(nil)).Where("type = ?", authChallengePasskeyLogin).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestAuthLoginRateLimitsAreDeclared(t *testing.T) {
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("test", "1"))
	h := NewAuthHandler(nil, nil, nil, nil, nil, false)
	h.Login(api)
	h.VerifyTOTPLogin(api)
	for _, path := range []string{"/auth/login", "/auth/login/totp"} {
		operation := api.OpenAPI().Paths[path].Post
		require.Contains(t, operation.Responses, "429", path)
		require.NotEmpty(t, operation.Responses["429"].Content["application/problem+json"].Schema.Ref)
	}
}
