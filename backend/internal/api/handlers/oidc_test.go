package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/billing"
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

func TestOIDCSignupRequiresTheHostedPurchaseChoiceBeforeRedirecting(t *testing.T) {
	t.Parallel()
	choiceService := billing.NewService(nil, "", billing.PaddleConfig{
		Plans: billing.DefaultPlanCatalog(
			billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{},
			billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{},
		),
		PurchaseChoiceSecret: "purchase-choice-secret-with-at-least-32-characters",
	})
	authHandler := NewAuthHandler(nil, auth.NewService("oidc-choice-secret"), nil, nil, nil, false)
	authHandler.SetPurchaseChoices(choiceService, true)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewOIDCHandler(nil, authHandler, nil).registerPublicRoutes(api)

	missing := jsonRequest(
		t,
		e,
		http.MethodGet,
		"/api/v1/auth/oidc/google/start?signup=true&return_path=%2Fonboarding%3Fplan%3Dfounder%26billing_period%3Dmonthly",
		nil,
		"",
	)
	require.Equal(t, http.StatusBadRequest, missing.Code, missing.Body.String())
	require.Contains(t, missing.Body.String(), "purchase choice is required")

	invalid := jsonRequest(
		t,
		e,
		http.MethodGet,
		"/api/v1/auth/oidc/google/start?signup=true&plan_id=founder&billing_period=monthly&purchase_choice_token=invalid&return_path=%2Fonboarding%3Fplan%3Dfounder%26billing_period%3Dmonthly",
		nil,
		"",
	)
	require.Equal(t, http.StatusBadRequest, invalid.Code, invalid.Body.String())
	require.Contains(t, invalid.Body.String(), "purchase choice is invalid")

	choice, err := choiceService.CreatePurchaseChoice("team", "annual")
	require.NoError(t, err)
	missingSelection := jsonRequest(
		t,
		e,
		http.MethodGet,
		"/api/v1/auth/oidc/google/start?signup=true&purchase_choice_token="+choice.Token,
		nil,
		"",
	)
	require.Equal(t, http.StatusBadRequest, missingSelection.Code, missingSelection.Body.String())
	require.Contains(t, missingSelection.Body.String(), "purchase choice is required")

	mismatched := jsonRequest(
		t,
		e,
		http.MethodGet,
		"/api/v1/auth/oidc/google/start?signup=true&plan_id=founder&billing_period=monthly&purchase_choice_token="+choice.Token,
		nil,
		"",
	)
	require.Equal(t, http.StatusBadRequest, mismatched.Code, mismatched.Body.String())
	require.Contains(t, mismatched.Body.String(), "does not match")
}

func TestPurchaseChoiceReturnPathUsesTheVerifiedChoice(t *testing.T) {
	t.Parallel()
	choice := billing.PurchaseChoice{
		Token:         "verified-token",
		PlanID:        "team",
		BillingPeriod: "annual",
	}

	returnPath := purchaseChoiceReturnPath(
		"/onboarding?plan=founder&billing_period=monthly&purchase_choice=other&redirect=%2Fcalendar&source=signup",
		choice,
	)
	parsed, err := url.Parse(returnPath)
	require.NoError(t, err)
	require.Equal(t, "/onboarding", parsed.Path)
	require.Equal(t, "team", parsed.Query().Get("plan"))
	require.Equal(t, "annual", parsed.Query().Get("billing_period"))
	require.Equal(t, "verified-token", parsed.Query().Get("purchase_choice"))
	require.Equal(t, "/calendar", parsed.Query().Get("redirect"))
	require.Equal(t, "signup", parsed.Query().Get("source"))

	external := purchaseChoiceReturnPath("https://attacker.example/steal", choice)
	externalURL, err := url.Parse(external)
	require.NoError(t, err)
	require.Equal(t, "/onboarding", externalURL.Path)
	require.Equal(t, "team", externalURL.Query().Get("plan"))
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewOIDCHandler(identityService, authHandler, passwordReauthTestAuthenticator{}).RegisterRoutes(api)

	response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/reauth/password", map[string]string{
		"action": "identity.email.change", "password": "correct-password-123",
	}, "web-token")
	require.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())

	grantCount, err := db.NewSelect().Model((*models.ReauthGrant)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, grantCount, "a disabled password must not mint a reauthentication grant")
}

func TestLinkedIdentitiesExposeProviderActivityWithoutHidingDisabledLinks(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.IdentityProvider)(nil),
		(*models.UserIdentity)(nil),
	)
	now := time.Now().UTC()
	rows := []any{
		&models.User{ID: "user-1", Email: "user@example.com", CreatedAt: now},
		&models.IdentityProvider{
			ID: "disabled-provider", Issuer: "https://disabled.example.test", Name: "A disabled provider",
			ClientID: "disabled-client", IsActive: false, CreatedAt: now, UpdatedAt: now,
		},
		&models.IdentityProvider{
			ID: "active-provider", Issuer: "https://active.example.test", Name: "Z active provider",
			ClientID: "active-client", IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		&models.UserIdentity{
			ID: "disabled-identity", ProviderID: "disabled-provider", Subject: "disabled-subject",
			UserID: "user-1", LinkedEmail: "user@example.com", CreatedAt: now,
		},
		&models.UserIdentity{
			ID: "active-identity", ProviderID: "active-provider", Subject: "active-subject",
			UserID: "user-1", LinkedEmail: "user@example.com", CreatedAt: now,
		},
	}
	for _, row := range rows {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	authService := auth.NewService("linked-identity-test-secret")
	authHandler := NewAuthHandler(db, authService, passwordReauthTestAuthenticator{}, nil, nil, false)
	identityService := identity.NewService(db, nil, identity.Config{})
	authHandler.SetIdentityService(identityService)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewOIDCHandler(identityService, authHandler, passwordReauthTestAuthenticator{}).RegisterRoutes(api)

	response := jsonRequest(t, e, http.MethodGet, "/api/v1/auth/oidc/identities", nil, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var identities []OIDCIdentitySummary
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &identities))
	require.Len(t, identities, 2, "disabled links remain visible for account management")
	require.Equal(t, "disabled-provider", identities[0].ProviderID)
	require.False(t, identities[0].Active)
	require.Equal(t, "active-provider", identities[1].ProviderID)
	require.True(t, identities[1].Active)
}

func TestOIDCPolicyContractOnlyAdvertisesSupportedAPITokenModes(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t)
	authService := auth.NewService("oidc-policy-openapi-test-secret")
	authenticator := passwordReauthTestAuthenticator{}
	authHandler := NewAuthHandler(db, authService, authenticator, nil, nil, false)
	identityService := identity.NewService(db, nil, identity.Config{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewOIDCHandler(identityService, authHandler, authenticator).registerAdministrationRoutes(api)

	for _, schemaName := range []string{"OIDCPolicyInputBody", "Policy"} {
		schema := api.OpenAPI().Components.Schemas.Map()[schemaName]
		require.NotNil(t, schema, schemaName)
		apiTokenMode := schema.Properties["api_token_mode"]
		require.NotNil(t, apiTokenMode, schemaName)
		require.Equal(t, []any{"scoped", "deny"}, apiTokenMode.Enum, schemaName)
	}
}
