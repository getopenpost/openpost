package handlers

import (
	"context"
	"errors"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/emailchange"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/stretchr/testify/require"
)

type emailChangeAuthenticator struct{}

func (emailChangeAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	if token != "web-token" {
		return nil, errors.New("invalid token")
	}
	return &middleware.Principal{UserID: "user-1", Email: "old@example.com", SessionID: "session-current"}, nil
}

type recordingEmailChangeSender struct {
	notifications []passwordmail.IdentityMessage
	err           error
}

func (s *recordingEmailChangeSender) SendIdentityEmail(_ context.Context, message passwordmail.IdentityMessage) error {
	if s.err != nil {
		return s.err
	}
	s.notifications = append(s.notifications, message)
	return nil
}

type acceptingEmailChangeReauth struct {
	calls int
}

func (r *acceptingEmailChangeReauth) ConsumeReauthGrant(
	_ context.Context,
	raw,
	userID,
	sessionID,
	action string,
) error {
	if raw != "reauth-grant" || userID != "user-1" || sessionID != "session-current" || action != reauthActionEmailChange {
		return errors.New("invalid reauthentication")
	}
	r.calls++
	return nil
}

func TestEmailChangeHandlerUsesGenericConflictAndRequiresRecentReauth(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.EmailChangeChallenge)(nil))
	for _, user := range []*models.User{
		{ID: "user-1", Email: "old@example.com", PasswordHash: "hash"},
		{ID: "user-2", Email: "taken@example.com", PasswordHash: "hash"},
	} {
		_, err := db.NewInsert().Model(user).Exec(context.Background())
		require.NoError(t, err)
	}
	sender := &recordingEmailChangeSender{}
	handler := NewEmailChangeHandler(
		emailchange.NewService(db, emailchange.Config{Secret: "email-change-handler-secret"}),
		&acceptingEmailChangeReauth{},
		sender,
		emailChangeAuthenticator{},
		"",
	)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.RegisterRoutes(api)

	missingReauth := jsonRequest(t, e, "POST", "/api/v1/auth/email-change", map[string]any{
		"new_email": "unused@example.com", "reauth_grant": "wrong",
	}, "web-token")
	require.Equal(t, 401, missingReauth.Code, missingReauth.Body.String())

	conflict := jsonRequest(t, e, "POST", "/api/v1/auth/email-change", map[string]any{
		"new_email": "taken@example.com", "reauth_grant": "reauth-grant",
	}, "web-token")
	require.Equal(t, 409, conflict.Code, conflict.Body.String())
	require.Contains(t, conflict.Body.String(), "that address cannot be used")
	require.NotContains(t, conflict.Body.String(), "user-2")
	require.Empty(t, sender.notifications)
}
