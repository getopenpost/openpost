package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/publicprofiles"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/billing"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
)

func TestRegisterUserMakesFirstUserAdminEvenWhenRegistrationsDisabled(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, true)

	user, err := handler.registerUserWithPolicy(context.Background(), "admin@example.com", "admin-user", "password123", false)
	require.NoError(t, err)
	require.True(t, user.IsAdmin)
}

func TestHostedRegistrationRequiresAValidPurchaseChoice(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
	authService := auth.NewService("test-secret")
	handler := NewAuthHandler(db, authService, nil, nil, nil, false)
	handler.SetSessionService(sessions.NewService(db))
	choiceService := billing.NewService(nil, "", billing.PaddleConfig{
		Plans: billing.DefaultPlanCatalog(
			billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{},
			billing.PaddlePriceIDs{}, billing.PaddlePriceIDs{},
		),
		PurchaseChoiceSecret: "pppppppppppppppppppppppppppppppp",
	})
	handler.SetPurchaseChoices(choiceService, true)
	recorder := &telemetry.MemoryRecorder{}
	handler.SetTelemetry(recorder)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.Register(api)

	missing := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "missing@example.com", "password": "password1234",
	}, "")
	require.Equal(t, http.StatusBadRequest, missing.Code, missing.Body.String())
	require.Contains(t, missing.Body.String(), "purchase choice is required")

	invalid := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "invalid@example.com", "password": "password1234", "purchase_choice_token": "invalid",
	}, "")
	require.Equal(t, http.StatusBadRequest, invalid.Code, invalid.Body.String())
	require.Contains(t, invalid.Body.String(), "purchase choice is invalid")

	choice, err := choiceService.CreatePurchaseChoice("agency", "monthly")
	require.NoError(t, err)
	valid := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "valid@example.com", "password": "password1234", "purchase_choice_token": choice.Token,
	}, "")
	require.Equal(t, http.StatusOK, valid.Code, valid.Body.String())
	require.Len(t, recorder.Events, 1)
	require.Equal(t, telemetry.EventSignupCompleted, recorder.Events[0].Name)
	require.NotEmpty(t, recorder.Events[0].DistinctID)
}

func TestRegisterUserRejectsAdditionalUsersWhenRegistrationsDisabled(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, true)

	_, err := handler.registerUserWithPolicy(context.Background(), "admin@example.com", "admin-user", "password123", false)
	require.NoError(t, err)

	_, err = handler.registerUserWithPolicy(context.Background(), "user@example.com", "normal-user", "password123", false)
	require.ErrorIs(t, err, errRegistrationsDisabled)
}

func TestRegisterUserReservesClosedRegistrationBootstrapWhileEmailIsUnverified(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, true)
	handler.emailVerificationRequired = true

	first, err := handler.registerUserWithPolicy(context.Background(), "admin@example.com", "admin-user", "password123", false)
	require.NoError(t, err)
	require.False(t, first.IsAdmin)
	require.True(t, first.EmailVerifiedAt.IsZero())

	_, err = handler.registerUserWithPolicy(context.Background(), "user@example.com", "normal-user", "password123", false)
	require.ErrorIs(t, err, errRegistrationsDisabled)
}

func TestRegisterUserOnlyPromotesTheFirstUser(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)

	firstUser, err := handler.registerUserWithPolicy(context.Background(), "admin@example.com", "admin-user", "password123", false)
	require.NoError(t, err)
	require.True(t, firstUser.IsAdmin)

	secondUser, err := handler.registerUserWithPolicy(context.Background(), "user@example.com", "normal-user", "password123", false)
	require.NoError(t, err)
	require.False(t, secondUser.IsAdmin)
}

func TestRegisterUserRequiresUniqueUsername(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)

	first, err := handler.registerUserWithPolicy(context.Background(), "one@example.com", "Creator-One", "password123", false)
	require.NoError(t, err)
	require.Equal(t, "creator-one", first.Username)

	_, err = handler.registerUserWithPolicy(context.Background(), "two@example.com", "creator-one", "password123", false)
	require.ErrorIs(t, err, errUsernameAlreadyRegistered)
}

func TestRegisterUserCreatesUsernameWhenOmitted(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)

	user, err := handler.registerUserWithPolicy(context.Background(), "Ada.Lovelace@example.com", "", "password123", false)
	require.NoError(t, err)
	require.Regexp(t, `^ada-lovelace-[a-f0-9]{6}$`, user.Username)
}

func TestRegistrationInsertErrorClassifiesUniqueConstraintRaces(t *testing.T) {
	t.Parallel()

	require.ErrorIs(t, registrationInsertError(errors.New("UNIQUE constraint failed: users.username")), errUsernameAlreadyRegistered)
	require.ErrorIs(t, registrationInsertError(errors.New("duplicate key value violates unique constraint users_email_key")), errEmailAlreadyRegistered)
	original := errors.New("database unavailable")
	require.ErrorIs(t, registrationInsertError(original), original)
}

func TestUpdateUserProfilePersistsComposerExperience(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	ctx := context.Background()
	user := &models.User{ID: "user-1", Email: "user@example.com"}
	_, err := db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)
	created, err := handler.getUserByID(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, "specialized", created.ComposerExperience)

	unified := "unified"
	err = handler.updateUserProfile(ctx, user.ID, UpdateProfileInputBody{
		ComposerExperience: &unified,
	})
	require.NoError(t, err)

	updated, err := handler.getUserByID(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, "unified", updated.ComposerExperience)
	require.Equal(t, "unified", handler.toUserProfile(updated).ComposerExperience)
}

func TestUpdateUserProfileRejectsUnknownComposerExperience(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	ctx := context.Background()
	user := &models.User{ID: "user-1", Email: "user@example.com"}
	_, err := db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)

	unknown := "custom"
	err = handler.updateUserProfile(ctx, user.ID, UpdateProfileInputBody{
		ComposerExperience: &unknown,
	})
	require.ErrorContains(t, err, "composer experience must be specialized or unified")
}

func TestUpdateUserProfilePersistsExplicitPublicVisibility(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	ctx := context.Background()
	user := &models.User{ID: "user-1", Email: "user@example.com", Username: "user-one"}
	_, err := db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)

	visible := []string{publicprofiles.FieldAvatar, publicprofiles.FieldActivity}
	err = handler.updateUserProfile(ctx, user.ID, UpdateProfileInputBody{PublicProfileVisibleFields: &visible})
	require.NoError(t, err)

	updated, err := handler.getUserByID(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, `["username","avatar","activity"]`, updated.PublicProfileVisibilityJSON)
	require.Equal(t, visible, handler.toUserProfile(updated).PublicProfileVisibleFields)

	empty := []string{}
	err = handler.updateUserProfile(ctx, user.ID, UpdateProfileInputBody{PublicProfileVisibleFields: &empty})
	require.NoError(t, err)
	updated, err = handler.getUserByID(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, `["username"]`, updated.PublicProfileVisibilityJSON)
	require.Empty(t, handler.toUserProfile(updated).PublicProfileVisibleFields)
}

func TestUpdateUserProfileRejectsUnknownPublicVisibilityField(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com"}).Exec(context.Background())
	require.NoError(t, err)
	visible := []string{"email"}
	err = handler.updateUserProfile(context.Background(), "user-1", UpdateProfileInputBody{PublicProfileVisibleFields: &visible})
	require.ErrorContains(t, err, "unsupported public profile field")
}

func TestUpdateUserProfileCannotEnableDisabledPublicCapability(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	handler.SetPublicProfilesEnabled(false)
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com", Username: "user-one"}).Exec(context.Background())
	require.NoError(t, err)
	enabled := true
	err = handler.updateUserProfile(context.Background(), "user-1", UpdateProfileInputBody{PublicProfileEnabled: &enabled})
	require.ErrorContains(t, err, "public profiles are disabled")
}

func TestUpdateUserProfileRequiresExplicitVisibilityWhenFirstEnabled(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", Username: "user-one",
	}).Exec(ctx)
	require.NoError(t, err)

	enabled := true
	err = handler.updateUserProfile(ctx, "user-1", UpdateProfileInputBody{PublicProfileEnabled: &enabled})
	require.ErrorContains(t, err, "choose which profile fields to show")

	visible := []string{}
	err = handler.updateUserProfile(ctx, "user-1", UpdateProfileInputBody{
		PublicProfileEnabled:       &enabled,
		PublicProfileVisibleFields: &visible,
	})
	require.NoError(t, err)
	updated, err := handler.getUserByID(ctx, "user-1")
	require.NoError(t, err)
	require.True(t, updated.PublicProfile)
	require.JSONEq(t, `["username"]`, updated.PublicProfileVisibilityJSON)
}

func TestUserProfileDefaultsUnknownComposerExperienceToSpecialized(t *testing.T) {
	t.Parallel()

	handler := NewAuthHandler(nil, nil, nil, nil, nil, false)
	profile := handler.toUserProfile(&models.User{ComposerExperience: ""})
	require.Equal(t, "specialized", profile.ComposerExperience)
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

func TestAuthSessionStateSupportsAnonymousAndAuthenticatedRequests(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	ctx := t.Context()
	user := &models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)

	authService := auth.NewService("test-secret")
	token, err := authService.GenerateToken(user.ID, user.Email)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(
		db,
		authService,
		middleware.NewJWTAuthenticator(authService),
		nil,
		nil,
		false,
	)
	handler.SessionState(api)

	anonymous := authSessionRequest(t, e, http.MethodGet, "/api/v1/auth/session-state", "")
	require.Equal(t, http.StatusOK, anonymous.Code, anonymous.Body.String())
	var anonymousBody AuthSessionStateOutput
	require.NoError(t, json.Unmarshal(anonymous.Body.Bytes(), &anonymousBody.Body))
	require.False(t, anonymousBody.Body.Authenticated)
	require.Nil(t, anonymousBody.Body.User)

	authenticated := authSessionRequest(t, e, http.MethodGet, "/api/v1/auth/session-state", token)
	require.Equal(t, http.StatusOK, authenticated.Code, authenticated.Body.String())
	var authenticatedBody AuthSessionStateOutput
	require.NoError(t, json.Unmarshal(authenticated.Body.Bytes(), &authenticatedBody.Body))
	require.True(t, authenticatedBody.Body.Authenticated)
	require.Equal(t, user.ID, authenticatedBody.Body.User.ID)

	invalid := authSessionRequest(t, e, http.MethodGet, "/api/v1/auth/session-state", "invalid")
	require.Equal(t, http.StatusOK, invalid.Code, invalid.Body.String())
	var invalidBody AuthSessionStateOutput
	require.NoError(t, json.Unmarshal(invalid.Body.Bytes(), &invalidBody.Body))
	require.False(t, invalidBody.Body.Authenticated)
}

func TestSessionCookieUsesTheDocumentedPersistentLifetime(t *testing.T) {
	t.Parallel()

	expiresAt := time.Now().UTC().Add(auth.TokenTTL)
	cookie := sessionCookie("signed-token", expiresAt, true)

	require.Equal(t, "openpost_session", cookie.Name)
	require.Equal(t, "signed-token", cookie.Value)
	require.Equal(t, "/", cookie.Path)
	require.True(t, cookie.HttpOnly)
	require.True(t, cookie.Secure)
	require.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
	require.WithinDuration(t, expiresAt, cookie.Expires, time.Second)
	require.InDelta(t, auth.TokenTTL.Seconds(), cookie.MaxAge, 2)
}

func authSessionRequest(t *testing.T, e *echo.Echo, method, path, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
