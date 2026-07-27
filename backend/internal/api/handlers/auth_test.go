package handlers

import (
	"context"
	"encoding/base64"
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
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
)

func TestRegisterUserMakesFirstUserAdminEvenWhenRegistrationsDisabled(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, true)

	user, err := handler.registerUserWithPolicy(context.Background(), "admin@example.com", "password123", false)
	require.NoError(t, err)
	require.True(t, user.IsAdmin)
}

func TestRegisterUserRejectsAdditionalUsersWhenRegistrationsDisabled(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, true)

	_, err := handler.registerUserWithPolicy(context.Background(), "admin@example.com", "password123", false)
	require.NoError(t, err)

	_, err = handler.registerUserWithPolicy(context.Background(), "user@example.com", "password123", false)
	require.ErrorIs(t, err, errRegistrationsDisabled)
}

func TestRegisterUserOnlyPromotesTheFirstUser(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)

	firstUser, err := handler.registerUserWithPolicy(context.Background(), "admin@example.com", "password123", false)
	require.NoError(t, err)
	require.True(t, firstUser.IsAdmin)

	secondUser, err := handler.registerUserWithPolicy(context.Background(), "user@example.com", "password123", false)
	require.NoError(t, err)
	require.False(t, secondUser.IsAdmin)
}

func TestResolveTOTPSetupSecretDecryptsEncryptedPayload(t *testing.T) {
	t.Parallel()

	encryptor := crypto.NewTokenEncryptor("test-secret")
	handler := NewAuthHandler(nil, nil, nil, encryptor, nil, false)

	secretEnc, err := encryptor.Encrypt("super-secret-seed")
	require.NoError(t, err)

	secret, err := handler.resolveTOTPSetupSecret(totpSetupPayload{
		SecretEncrypted: base64.StdEncoding.EncodeToString(secretEnc),
	})
	require.NoError(t, err)
	require.Equal(t, "super-secret-seed", secret)
}

func TestCreateChallengeDoesNotPersistPlaintextTOTPSecret(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.AuthChallenge)(nil))
	encryptor := crypto.NewTokenEncryptor("test-secret")
	handler := NewAuthHandler(db, nil, nil, encryptor, nil, false)
	ctx := context.Background()

	secretEnc, err := encryptor.Encrypt("super-secret-seed")
	require.NoError(t, err)

	challengeID, err := handler.createChallenge(ctx, "user-1", authChallengeTOTPSetup, totpSetupPayload{
		SecretEncrypted: base64.StdEncoding.EncodeToString(secretEnc),
	})
	require.NoError(t, err)

	challenge, err := handler.getChallenge(ctx, challengeID, authChallengeTOTPSetup)
	require.NoError(t, err)
	require.NotContains(t, challenge.Payload, "super-secret-seed")

	var payload totpSetupPayload
	require.NoError(t, json.Unmarshal([]byte(challenge.Payload), &payload))

	secret, err := handler.resolveTOTPSetupSecret(payload)
	require.NoError(t, err)
	require.Equal(t, "super-secret-seed", secret)
}

func TestIssueAuthResponseCreatesTrackedSession(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
	authService := auth.NewService("test-secret")
	sessionService := sessions.NewService(db)
	handler := NewAuthHandler(db, authService, nil, nil, nil, false)
	handler.SetSessionService(sessionService)
	ctx := context.Background()

	user := &models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)

	reqCtx := context.WithValue(ctx, middleware.UserAgentKey, "OpenPost Test Browser")
	reqCtx = context.WithValue(reqCtx, middleware.ClientIPKey, "198.51.100.4")
	resp, err := handler.issueAuthResponse(reqCtx, user)
	require.NoError(t, err)
	require.NotEmpty(t, resp.Body.Token)
	require.Contains(t, resp.SetCookie, "openpost_session=")
	require.Contains(t, resp.SetCookie, "HttpOnly")
	require.Contains(t, resp.SetCookie, "SameSite=Lax")

	claims, err := authService.ValidateToken(resp.Body.Token)
	require.NoError(t, err)
	require.NotEmpty(t, claims.SessionID)

	var stored models.UserSession
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", claims.SessionID).Scan(ctx))
	require.Equal(t, "user-1", stored.UserID)
	require.Equal(t, "OpenPost Test Browser", stored.UserAgent)
	require.Equal(t, "198.51.100.4", stored.IPAddress)
	require.True(t, stored.ExpiresAt.After(time.Now().UTC()))
}

func TestAuthHandlerListsAndRevokesSessions(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	authService := auth.NewService("test-secret")
	sessionService := sessions.NewService(db)
	current, err := sessionService.CreateSession(ctx, sessions.CreateInput{
		UserID:    "user-1",
		UserAgent: "Current Browser",
		IPAddress: "203.0.113.10",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	other, err := sessionService.CreateSession(ctx, sessions.CreateInput{
		UserID:    "user-1",
		UserAgent: "Other Browser",
		IPAddress: "203.0.113.11",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession("user-1", "user@example.com", current.ID, current.ExpiresAt)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(
		db,
		authService,
		middleware.NewJWTAuthenticatorWithSessions(authService, sessionService),
		nil,
		nil,
		false,
	)
	handler.SetSessionService(sessionService)
	handler.ListSessions(api)
	handler.RevokeSession(api)

	listResp := authSessionRequest(t, e, http.MethodGet, "/api/v1/auth/sessions", token)
	require.Equal(t, http.StatusOK, listResp.Code, listResp.Body.String())

	var listOut []UserSessionSummary
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &listOut))
	require.Len(t, listOut, 2)
	summaries := map[string]UserSessionSummary{}
	for _, item := range listOut {
		summaries[item.ID] = item
	}
	require.True(t, summaries[current.ID].Current)
	require.False(t, summaries[other.ID].Current)

	revokeResp := authSessionRequest(t, e, http.MethodDelete, "/api/v1/auth/sessions/"+other.ID, token)
	require.Equal(t, http.StatusOK, revokeResp.Code, revokeResp.Body.String())
	var revokeOut struct {
		Revoked        bool `json:"revoked"`
		RevokedCurrent bool `json:"revoked_current"`
	}
	require.NoError(t, json.Unmarshal(revokeResp.Body.Bytes(), &revokeOut))
	require.True(t, revokeOut.Revoked)
	require.False(t, revokeOut.RevokedCurrent)

	var revoked models.UserSession
	require.NoError(t, db.NewSelect().Model(&revoked).Where("id = ?", other.ID).Scan(ctx))
	require.False(t, revoked.RevokedAt.IsZero())
}

func authSessionRequest(t *testing.T, e *echo.Echo, method, path, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
