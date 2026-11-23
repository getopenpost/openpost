package handlers

import (
	"context"

	"net/http"

	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"

	"github.com/openpost/backend/internal/services/identity"
	"github.com/stretchr/testify/require"
)

type passwordReauthTestAuthenticator struct{}

func (passwordReauthTestAuthenticator) AuthenticateBearer(
	_ context.Context,
	_ string,
) (*middleware.Principal, error) {
	return &middleware.Principal{
		UserID:    "user-1",
		Email:     "user@example.com",
		SessionID: "session-1",
	}, nil
}

func TestPasswordReauthenticationRejectsPasswordDisabledByRequiredSSO(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.ReauthGrant)(nil),
	)
	authService := auth.NewService("password-reauth-test-secret")
	passwordHash, err := authService.HashPassword("correct-password-123")
	require.NoError(t, err)
	now := time.Now().UTC()
	rows := []any{
		&models.User{
			ID: "user-1", Email: "user@example.com", PasswordHash: passwordHash, CreatedAt: now,
		},
		&models.Organization{
			ID: "organization-1", Name: "Required SSO", CreatedByID: "user-1",
			CreatedAt: now, UpdatedAt: now,
		},
		&models.OrganizationMember{
			OrganizationID: "organization-1", UserID: "user-1",
			Role: models.OrganizationRoleOwner, CreatedAt: now,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID: "organization-1", Mode: models.OrganizationSSOModeRequired,
			ProviderIDs: `["instance"]`, AssuranceMaxAgeSeconds: 3600,
			PasswordLoginAllowed: false, APITokenMode: models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: 3600, RequireTokenReauth: true,
			CreatedAt: now, UpdatedAt: now,
		},
	}
	for _, row := range rows {
		_, err = db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	identityService := identity.NewService(db, nil, identity.Config{})
	authHandler := NewAuthHandler(db, authService, passwordReauthTestAuthenticator{}, nil, nil, false)
	authHandler.SetIdentityService(identityService)
	profile := authHandler.profileForUser(t.Context(), rows[0].(*models.User))
	require.True(t, profile.HasPassword, "the stored credential remains present")
	require.False(t, profile.PasswordUsable, "required SSO disables password step-up")

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewOIDCHandler(identityService, authHandler, passwordReauthTestAuthenticator{}).RegisterRoutes(api)

	response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/reauth/password", map[string]string{
		"action": "identity.email.change", "password": "correct-password-123",
	}, "web-token")
	require.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())

	grantCount, err := db.NewSelect().Model((*models.ReauthGrant)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, grantCount, "a disabled password must not mint a reauthentication grant")
}
