package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	"github.com/openpost/backend/internal/legalpolicy"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
)

type recordingPasswordSender struct {
	messages []passwordmail.ResetMessage
	err      error
}

func TestValidateNewPasswordCountsUnicodeCharacters(t *testing.T) {
	t.Parallel()

	require.Error(t, validateNewPassword(strings.Repeat("🔐", 11)))
	require.NoError(t, validateNewPassword(strings.Repeat("🔐", 12)))
	require.NoError(t, validateNewPassword(strings.Repeat("🔐", 1024)))
	require.Error(t, validateNewPassword(strings.Repeat("🔐", 1025)))
}

func (s *recordingPasswordSender) SendPasswordReset(_ context.Context, message passwordmail.ResetMessage) error {
	s.messages = append(s.messages, message)
	return s.err
}

func (s *recordingPasswordSender) SendEmailVerification(_ context.Context, _ passwordmail.VerificationMessage) error {
	return s.err
}

func (s *recordingPasswordSender) SendNotification(_ context.Context, _ passwordmail.NotificationMessage) error {
	return s.err
}

func TestPasswordResetIsNonEnumeratingSingleUseAndRevokesSessions(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.PasswordResetToken)(nil),
		(*models.UserSession)(nil),
	)
	authService := auth.NewService("test-secret")
	passwordHash, err := authService.HashPassword("old-password-123")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "person@example.com",
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.UserSession{
		ID:        "session-1",
		UserID:    "user-1",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	sender := &recordingPasswordSender{}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(db, authService, nil, nil, nil, false)
	handler.SetPasswordResetSender(sender, "https://app.openpost.test")
	handler.RequestPasswordReset(api)
	handler.ResetPassword(api)

	existing := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/password-reset/request", map[string]string{"email": "person@example.com"}, "")
	unknown := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/password-reset/request", map[string]string{"email": "unknown@example.com"}, "")
	require.Equal(t, http.StatusOK, existing.Code, existing.Body.String())
	require.Equal(t, existing.Body.String(), unknown.Body.String())
	require.Len(t, sender.messages, 1)

	fragmentURL, err := url.Parse(sender.messages[0].ResetURL)
	require.NoError(t, err)
	rawToken := strings.TrimPrefix(fragmentURL.Fragment, "token=")
	require.NotEmpty(t, rawToken)
	var stored models.PasswordResetToken
	require.NoError(t, db.NewSelect().Model(&stored).Scan(t.Context()))
	require.NotEqual(t, rawToken, stored.TokenHash)
	require.Equal(t, hashPasswordResetToken(rawToken), stored.TokenHash)

	confirm := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/password-reset/confirm", map[string]string{
		"token":        rawToken,
		"new_password": "new-password-456",
	}, "")
	require.Equal(t, http.StatusOK, confirm.Code, confirm.Body.String())

	var updated models.User
	require.NoError(t, db.NewSelect().Model(&updated).Where("id = ?", "user-1").Scan(t.Context()))
	require.True(t, authService.CheckPassword("new-password-456", updated.PasswordHash))
	require.False(t, authService.CheckPassword("old-password-123", updated.PasswordHash))
	var session models.UserSession
	require.NoError(t, db.NewSelect().Model(&session).Where("id = ?", "session-1").Scan(t.Context()))
	require.False(t, session.RevokedAt.IsZero())

	replay := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/password-reset/confirm", map[string]string{
		"token":        rawToken,
		"new_password": "another-password-789",
	}, "")
	require.Equal(t, http.StatusBadRequest, replay.Code, replay.Body.String())
}

func TestPasswordResetDeliveryFailureKeepsGenericResponseAndRemovesToken(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.PasswordResetToken)(nil))
	authService := auth.NewService("test-secret")
	passwordHash, err := authService.HashPassword("old-password-123")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "person@example.com", PasswordHash: passwordHash, CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	sender := &recordingPasswordSender{err: errors.New("mail server unavailable")}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(db, authService, nil, nil, nil, false)
	handler.SetPasswordResetSender(sender, "https://app.openpost.test")
	handler.RequestPasswordReset(api)

	existing := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/password-reset/request", map[string]string{"email": "person@example.com"}, "")
	unknown := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/password-reset/request", map[string]string{"email": "unknown@example.com"}, "")
	require.Equal(t, http.StatusOK, existing.Code, existing.Body.String())
	require.Equal(t, existing.Body.String(), unknown.Body.String())
	require.Len(t, sender.messages, 1)
	count, err := db.NewSelect().Model((*models.PasswordResetToken)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestChangePasswordPreservesCurrentSessionAndRevokesOthers(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
	authService := auth.NewService("test-secret")
	passwordHash, err := authService.HashPassword("current-password-123")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "person@example.com",
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	sessionService := sessions.NewService(db)
	current, err := sessionService.CreateSession(t.Context(), sessions.CreateInput{
		UserID: "user-1", ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	other, err := sessionService.CreateSession(t.Context(), sessions.CreateInput{
		UserID: "user-1", ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession("user-1", "person@example.com", current.ID, current.ExpiresAt)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(db, authService, middleware.NewJWTAuthenticatorWithSessions(authService, sessionService), nil, nil, false)
	handler.ChangePassword(api)

	response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/password", map[string]string{
		"current_password": "current-password-123",
		"new_password":     "replacement-password-456",
	}, token)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	_, err = sessionService.ValidateSession(t.Context(), "user-1", current.ID)
	require.NoError(t, err)
	_, err = sessionService.ValidateSession(t.Context(), "user-1", other.ID)
	require.ErrorIs(t, err, sessions.ErrRevokedSession)
}

func TestRegistrationRequiresAndPersistsCurrentLegalAcceptance(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
	authService := auth.NewService("test-secret")
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(db, authService, nil, nil, nil, false)
	handler.SetSessionService(sessions.NewService(db))
	handler.SetAccountPolicy(AccountPolicy{
		Required: true, TermsVersion: "2026-07-22", PrivacyVersion: "2026-07-22",
	})
	handler.Register(api)

	rejected := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "person@example.com", "username": "person", "password": "long-password-123", "accepted_legal": false,
	}, "")
	require.Equal(t, http.StatusBadRequest, rejected.Code, rejected.Body.String())

	accepted := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "person@example.com", "username": "person", "password": "long-password-123", "accepted_legal": true,
	}, "")
	require.Equal(t, http.StatusOK, accepted.Code, accepted.Body.String())
	var user models.User
	require.NoError(t, db.NewSelect().Model(&user).Where("email = ?", "person@example.com").Scan(t.Context()))
	require.Equal(t, "2026-07-22", user.TermsVersion)
	require.Equal(t, "2026-07-22", user.PrivacyVersion)
	require.False(t, user.LegalAcceptedAt.IsZero())
}

func TestExistingAccountAcceptedOlderPolicyMustAcceptCurrentPolicy(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
	authService := auth.NewService("test-secret")
	hash, err := authService.HashPassword("long-password-123")
	require.NoError(t, err)
	user := &models.User{
		ID: "user-1", Email: "existing@example.com", PasswordHash: hash,
		TermsVersion: "2026-08-04", PrivacyVersion: "2026-08-04",
		LegalAcceptedAt: time.Now().UTC().Add(-24 * time.Hour), CreatedAt: time.Now().UTC(),
	}
	_, err = db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	sessionService := sessions.NewService(db)
	session, err := sessionService.CreateSession(t.Context(), sessions.CreateInput{
		UserID: user.ID, ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession(user.ID, user.Email, session.ID, session.ExpiresAt)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(
		db, authService, middleware.NewJWTAuthenticatorWithSessions(authService, sessionService), nil, nil, false,
	)
	handler.SetAccountPolicy(AccountPolicy{
		Required: true, TermsVersion: legalpolicy.TermsVersion, PrivacyVersion: legalpolicy.PrivacyVersion,
	})
	handler.Me(api)
	handler.AcceptAccountPolicy(api)

	before := jsonRequest(t, e, http.MethodGet, "/api/v1/auth/me", nil, token)
	require.Equal(t, http.StatusOK, before.Code, before.Body.String())
	require.Contains(t, before.Body.String(), `"legal_acceptance_required":true`)

	accepted := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/legal-acceptance", map[string]bool{
		"accepted_legal": true,
	}, token)
	require.Equal(t, http.StatusOK, accepted.Code, accepted.Body.String())
	require.Contains(t, accepted.Body.String(), `"legal_acceptance_required":false`)

	var stored models.User
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", user.ID).Scan(t.Context()))
	require.Equal(t, legalpolicy.TermsVersion, stored.TermsVersion)
	require.Equal(t, legalpolicy.PrivacyVersion, stored.PrivacyVersion)
	require.False(t, stored.LegalAcceptedAt.IsZero())
}

func jsonRequest(t *testing.T, e *echo.Echo, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
