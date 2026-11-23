package handlers

import (
	"bytes"
	"context"
	"encoding/json"

	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/passwordmail"

	"github.com/stretchr/testify/require"
)

type recordingPasswordSender struct {
	messages []passwordmail.ResetMessage
	err      error
}

func (s *recordingPasswordSender) SendPasswordReset(_ context.Context, message passwordmail.ResetMessage) error {
	s.messages = append(s.messages, message)
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
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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
