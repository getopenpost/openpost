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
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/emailverification"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
)

type recordingVerificationSender struct {
	verificationMessages []passwordmail.VerificationMessage
	err                  error
}

func (s *recordingVerificationSender) SendEmailVerification(
	_ context.Context,
	message passwordmail.VerificationMessage,
) error {
	s.verificationMessages = append(s.verificationMessages, message)
	return s.err
}

func TestEmailRegistrationRequiresCodeBeforeIssuingSession(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.EmailVerificationChallenge)(nil),
		(*models.UserSession)(nil),
	)
	authService := auth.NewService("email-verification-handler-secret")
	verification := emailverification.NewService(db, emailverification.Config{
		Secret:               "email-verification-handler-secret",
		PromoteFirstVerified: true,
	})
	sender := &recordingVerificationSender{}
	handler := NewAuthHandler(db, authService, nil, nil, nil, false)
	handler.SetSessionService(sessions.NewService(db))
	handler.SetEmailVerification(verification, sender, true)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.Register(api)
	handler.Login(api)
	handler.ConfirmEmailVerification(api)
	handler.ResendEmailVerification(api)

	register := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "new-user@example.com", "username": "new-user", "password": "password-1234",
	}, "")
	require.Equal(t, http.StatusOK, register.Code, register.Body.String())
	var pending AuthOutput
	require.NoError(t, json.Unmarshal(register.Body.Bytes(), &pending.Body))
	require.True(t, pending.Body.RequiresEmailVerification)
	require.NotEmpty(t, pending.Body.EmailVerificationID)
	require.Equal(t, "sent", pending.Body.EmailDeliveryStatus)
	require.Empty(t, pending.Body.Token)
	require.Len(t, sender.verificationMessages, 1)

	login := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": "new-user@example.com", "password": "password-1234",
	}, "")
	require.Equal(t, http.StatusOK, login.Code, login.Body.String())
	var loginPending AuthOutput
	require.NoError(t, json.Unmarshal(login.Body.Bytes(), &loginPending.Body))
	require.Equal(t, pending.Body.EmailVerificationID, loginPending.Body.EmailVerificationID)
	require.Len(t, sender.verificationMessages, 1, "login must not send duplicate codes")

	wrongCode := "000000"
	if sender.verificationMessages[0].Code == wrongCode {
		wrongCode = "000001"
	}
	wrong := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/email-verification/confirm", map[string]any{
		"challenge_id": pending.Body.EmailVerificationID, "code": wrongCode,
	}, "")
	require.Equal(t, http.StatusBadRequest, wrong.Code, wrong.Body.String())

	confirm := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/email-verification/confirm", map[string]any{
		"challenge_id": pending.Body.EmailVerificationID,
		"code":         sender.verificationMessages[0].Code,
	}, "")
	require.Equal(t, http.StatusOK, confirm.Code, confirm.Body.String())
	var authenticated AuthOutput
	require.NoError(t, json.Unmarshal(confirm.Body.Bytes(), &authenticated.Body))
	require.NotEmpty(t, authenticated.Body.Token)
	require.True(t, authenticated.Body.User.EmailVerified)
	require.True(t, authenticated.Body.User.IsAdmin)

	replay := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/email-verification/confirm", map[string]any{
		"challenge_id": pending.Body.EmailVerificationID,
		"code":         sender.verificationMessages[0].Code,
	}, "")
	require.Equal(t, http.StatusBadRequest, replay.Code, replay.Body.String())
}

func TestEmailVerificationResendRotatesCodeAndReportsDeliveryFailure(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.EmailVerificationChallenge)(nil))
	user := &models.User{ID: "user-1", Email: "person@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC()}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	verification := emailverification.NewService(db, emailverification.Config{Secret: "verification-secret"})
	pending, err := verification.Create(t.Context(), user.ID)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.EmailVerificationChallenge)(nil)).
		Set("sent_at = ?", time.Now().UTC().Add(-2*time.Minute)).
		Where("id = ?", pending.Challenge.ID).Exec(t.Context())
	require.NoError(t, err)

	sender := &recordingVerificationSender{err: context.DeadlineExceeded}
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	handler.SetEmailVerification(verification, sender, true)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.ResendEmailVerification(api)

	response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/email-verification/resend", map[string]any{
		"challenge_id": pending.Challenge.ID,
	}, "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output AuthOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.Equal(t, "failed", output.Body.EmailDeliveryStatus)
	require.NotEqual(t, pending.Challenge.ID, output.Body.EmailVerificationID)
	require.Len(t, sender.verificationMessages, 1)
}
