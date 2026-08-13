package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"testing"
	"time"

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
	notifications []passwordmail.NotificationMessage
	err           error
}

func (s *recordingEmailChangeSender) SendPasswordReset(_ context.Context, _ passwordmail.ResetMessage) error {
	return s.err
}

func (s *recordingEmailChangeSender) SendEmailVerification(_ context.Context, _ passwordmail.VerificationMessage) error {
	return s.err
}

func (s *recordingEmailChangeSender) SendNotification(_ context.Context, message passwordmail.NotificationMessage) error {
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

func TestEmailChangeHandlerVerifiesBeforeReplacingAndNotifiesBothAddresses(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.EmailChangeChallenge)(nil),
		(*models.UserSession)(nil),
		(*models.PasswordResetToken)(nil),
	)
	now := time.Now().UTC()
	for _, row := range []any{
		&models.User{ID: "user-1", Email: "old@example.com", PasswordHash: "hash", CreatedAt: now},
		&models.UserSession{ID: "session-current", UserID: "user-1", ExpiresAt: now.Add(time.Hour), CreatedAt: now},
		&models.UserSession{ID: "session-other", UserID: "user-1", ExpiresAt: now.Add(time.Hour), CreatedAt: now},
		&models.PasswordResetToken{ID: "reset-1", UserID: "user-1", TokenHash: "hash", ExpiresAt: now.Add(time.Hour), CreatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(context.Background())
		require.NoError(t, err)
	}

	sender := &recordingEmailChangeSender{}
	reauth := &acceptingEmailChangeReauth{}
	handler := NewEmailChangeHandler(
		emailchange.NewService(db, emailchange.Config{Secret: "email-change-handler-secret"}),
		reauth,
		sender,
		emailChangeAuthenticator{},
		"https://openpost.example",
	)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.RegisterRoutes(api)

	begin := jsonRequest(t, e, "POST", "/api/v1/auth/email-change", map[string]any{
		"new_email": "new@example.com", "reauth_grant": "reauth-grant",
	}, "web-token")
	require.Equal(t, 201, begin.Code, begin.Body.String())
	require.Equal(t, 1, reauth.calls)
	require.Len(t, sender.notifications, 2)
	require.Equal(t, "new@example.com", sender.notifications[0].Recipient)
	require.Equal(t, "old@example.com", sender.notifications[1].Recipient)

	var unchanged models.User
	require.NoError(t, db.NewSelect().Model(&unchanged).Where("id = ?", "user-1").Scan(context.Background()))
	require.Equal(t, "old@example.com", unchanged.Email)
	code := regexp.MustCompile(`\b[0-9]{6}\b`).FindString(sender.notifications[0].Body)
	require.Len(t, code, 6)

	var pending BeginEmailChangeOutput
	require.NoError(t, json.Unmarshal(begin.Body.Bytes(), &pending.Body))
	confirm := jsonRequest(t, e, "POST", "/api/v1/auth/email-change/"+pending.Body.ID+"/confirm", map[string]any{
		"code": code,
	}, "web-token")
	require.Equal(t, 200, confirm.Code, confirm.Body.String())
	require.Len(t, sender.notifications, 4)
	require.Equal(t, "new@example.com", sender.notifications[2].Recipient)
	require.Equal(t, "old@example.com", sender.notifications[3].Recipient)

	var changed models.User
	require.NoError(t, db.NewSelect().Model(&changed).Where("id = ?", "user-1").Scan(context.Background()))
	require.Equal(t, "new@example.com", changed.Email)
	require.False(t, changed.EmailVerifiedAt.IsZero())
	var current, other models.UserSession
	require.NoError(t, db.NewSelect().Model(&current).Where("id = ?", "session-current").Scan(context.Background()))
	require.NoError(t, db.NewSelect().Model(&other).Where("id = ?", "session-other").Scan(context.Background()))
	require.True(t, current.RevokedAt.IsZero())
	require.False(t, other.RevokedAt.IsZero())
	var reset models.PasswordResetToken
	require.NoError(t, db.NewSelect().Model(&reset).Where("id = ?", "reset-1").Scan(context.Background()))
	require.False(t, reset.UsedAt.IsZero())
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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
