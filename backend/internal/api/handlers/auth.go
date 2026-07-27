package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/mfa"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	authChallengeLoginMFA     = "login_mfa"
	authChallengeTOTPSetup    = "totp_setup"
	authChallengePasskeySetup = "passkey_setup"
	authChallengePasskeyLogin = "passkey_login"
	mfaMethodTOTP             = "totp"
	mfaMethodPasskey          = "passkey"
	passwordReauthError       = "current password is required"
	defaultPasskeyDisplayName = "Unnamed passkey"
)

type AuthHandler struct {
	db                    *bun.DB
	auth                  *auth.Service
	authenticator         middleware.Authenticator
	sessions              *sessions.Service
	encryptor             *crypto.TokenEncryptor
	mfa                   *mfa.Service
	registrationsDisabled bool
	limiter               *ratelimit.Limiter
	passwordResetSender   passwordmail.Sender
	publicURL             string
	accountPolicy         AccountPolicy
}

func NewAuthHandler(
	db *bun.DB,
	authService *auth.Service,
	authenticator middleware.Authenticator,
	encryptor *crypto.TokenEncryptor,
	mfaService *mfa.Service,
	registrationsDisabled bool,
) *AuthHandler {
	if authenticator == nil && authService != nil {
		authenticator = middleware.NewJWTAuthenticator(authService)
	}
	return &AuthHandler{
		db:                    db,
		auth:                  authService,
		authenticator:         authenticator,
		encryptor:             encryptor,
		mfa:                   mfaService,
		registrationsDisabled: registrationsDisabled,
		limiter:               ratelimit.New(),
	}
}

func (h *AuthHandler) SetSessionService(sessionService *sessions.Service) {
	h.sessions = sessionService
}

func (h *AuthHandler) SetPasswordResetSender(sender passwordmail.Sender, publicURL string) {
	h.passwordResetSender = sender
	h.publicURL = strings.TrimRight(strings.TrimSpace(publicURL), "/")
}

func (h *AuthHandler) SetAccountPolicy(policy AccountPolicy) {
	h.accountPolicy = policy.normalized()
}

var (
	errEmailAlreadyRegistered = errors.New("email already registered")
	errRegistrationsDisabled  = errors.New("registrations are disabled for this instance")
)

type RegisterInput struct {
	Body struct {
		Email         string `json:"email" format:"email" doc:"User email address"`
		Password      string `json:"password" minLength:"12" maxLength:"1024" doc:"User password (min 12 characters)"`
		AcceptedLegal *bool  `json:"accepted_legal,omitempty" doc:"Whether the user accepted the current terms and privacy policy"`
	}
}

type LoginInput struct {
	Body struct {
		Email    string `json:"email" format:"email" doc:"User email address"`
		Password string `json:"password" doc:"User password"`
	}
}

type VerifyTOTPLoginInput struct {
	Body struct {
		MFAToken string `json:"mfa_token" doc:"Pending MFA challenge token"`
		Code     string `json:"code" minLength:"6" maxLength:"6" doc:"Six digit authenticator code"`
	}
}

type BeginPasskeyLoginInput struct {
	Body struct {
		MFAToken string `json:"mfa_token" doc:"Pending MFA challenge token"`
	}
}

type FinishPasskeyLoginInput struct {
	Body struct {
		ChallengeID string          `json:"challenge_id" doc:"Passkey challenge ID"`
		Credential  json.RawMessage `json:"credential" doc:"WebAuthn assertion response"`
	}
}

type SetupTOTPInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
	}
}

type ConfirmTOTPSetupInput struct {
	Body struct {
		ChallengeID string `json:"challenge_id" doc:"TOTP setup challenge ID"`
		Code        string `json:"code" minLength:"6" maxLength:"6" doc:"Six digit authenticator code"`
	}
}

type DisableTOTPInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
	}
}

type BeginPasskeyRegistrationInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
		Name            string `json:"name" doc:"Optional passkey label"`
	}
}

type FinishPasskeyRegistrationInput struct {
	Body struct {
		ChallengeID string          `json:"challenge_id" doc:"Passkey registration challenge ID"`
		Name        string          `json:"name" doc:"Optional passkey label"`
		Credential  json.RawMessage `json:"credential" doc:"WebAuthn registration response"`
	}
}

type RemovePasskeyInput struct {
	PasskeyID string `path:"passkey_id" doc:"Passkey ID"`
	Body      struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
	}
}

type UserProfile struct {
	ID                      string    `json:"id" doc:"User ID"`
	Email                   string    `json:"email" doc:"User email address"`
	DisplayName             string    `json:"display_name" doc:"User display name"`
	AvatarURL               string    `json:"avatar_url" doc:"Profile avatar URL"`
	IsAdmin                 bool      `json:"is_admin" doc:"Whether this user can manage instance-level settings"`
	TermsVersion            string    `json:"terms_version,omitempty" doc:"Terms version accepted by the user"`
	PrivacyVersion          string    `json:"privacy_version,omitempty" doc:"Privacy version acknowledged by the user"`
	LegalAcceptedAt         time.Time `json:"legal_accepted_at,omitempty" doc:"When the current account policy was accepted"`
	LegalAcceptanceRequired bool      `json:"legal_acceptance_required" doc:"Whether the current hosted policy still needs acceptance"`
	CreatedAt               time.Time `json:"created_at" doc:"Account creation time"`
}

type UpdateProfileInput struct {
	Body struct {
		DisplayName *string `json:"display_name,omitempty" maxLength:"120" doc:"User display name"`
		AvatarURL   *string `json:"avatar_url,omitempty" maxLength:"1000" doc:"Profile avatar URL"`
	}
}

type AuthOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		Token       string       `json:"token,omitempty" doc:"JWT authentication token"`
		User        *UserProfile `json:"user,omitempty"`
		RequiresMFA bool         `json:"requires_mfa" doc:"Whether the login requires a second factor"`
		MFAToken    string       `json:"mfa_token,omitempty" doc:"Pending MFA token for follow-up verification"`
		MFAMethods  []string     `json:"mfa_methods,omitempty" doc:"Enabled MFA methods for this account"`
	}
}

type LogoutOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		Message string `json:"message"`
	}
}

type MeOutput struct {
	Body *UserProfile
}

type PasskeySummary struct {
	ID         string    `json:"id" doc:"Passkey ID"`
	Name       string    `json:"name" doc:"User-visible passkey label"`
	CreatedAt  time.Time `json:"created_at" doc:"When the passkey was registered"`
	LastUsedAt time.Time `json:"last_used_at" doc:"When the passkey was last used"`
}

type SecurityStatusOutput struct {
	Body struct {
		User        *UserProfile     `json:"user"`
		TOTPEnabled bool             `json:"totp_enabled" doc:"Whether authenticator-based 2FA is enabled"`
		Passkeys    []PasskeySummary `json:"passkeys"`
		Methods     []string         `json:"methods" doc:"Currently available MFA methods"`
	}
}

type UserSessionSummary struct {
	ID         string    `json:"id" doc:"Session ID"`
	UserAgent  string    `json:"user_agent" doc:"Recorded user agent"`
	DeviceName string    `json:"device_name" doc:"Human-readable browser and device label"`
	IPAddress  string    `json:"ip_address" doc:"Recorded client IP address"`
	Current    bool      `json:"current" doc:"Whether this is the session used for the request"`
	ExpiresAt  time.Time `json:"expires_at" doc:"Session expiry time"`
	LastUsedAt time.Time `json:"last_used_at" doc:"Last successful use time"`
	CreatedAt  time.Time `json:"created_at" doc:"Session creation time"`
}

type ListUserSessionsOutput struct {
	Body []UserSessionSummary
}

type RevokeUserSessionInput struct {
	SessionID string `path:"session_id" doc:"Session ID"`
}

type RevokeUserSessionOutput struct {
	Body struct {
		Revoked        bool `json:"revoked"`
		RevokedCurrent bool `json:"revoked_current"`
	}
}

type SetupTOTPOutput struct {
	Body struct {
		ChallengeID    string `json:"challenge_id"`
		ManualEntryKey string `json:"manual_entry_key"`
		OTPAuthURL     string `json:"otpauth_url"`
		QRCodeDataURL  string `json:"qr_code_data_url"`
	}
}

type PasskeyCeremonyOutput struct {
	Body struct {
		ChallengeID string      `json:"challenge_id"`
		Options     interface{} `json:"options"`
	}
}

type loginChallengePayload struct {
	Methods []string `json:"methods"`
}

type totpSetupPayload struct {
	Secret          string `json:"secret,omitempty"`
	SecretEncrypted string `json:"secret_encrypted,omitempty"`
}

type passkeyChallengePayload struct {
	SessionData string `json:"session_data"`
}

func (h *AuthHandler) Register(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "register",
		Method:      http.MethodPost,
		Path:        "/auth/register",
		Summary:     "Register a new user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 403, 409},
	}, func(ctx context.Context, input *RegisterInput) (*AuthOutput, error) {
		if err := validateNewPassword(input.Body.Password); err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		acceptedLegal := input.Body.AcceptedLegal != nil && *input.Body.AcceptedLegal
		if h.accountPolicy.Required && !acceptedLegal {
			return nil, huma.Error400BadRequest("accept the Terms of Service and Privacy Policy to continue")
		}
		if !h.allowAuthAttempt(clientIP(ctx), "register:ip", 10, time.Hour) {
			return nil, huma.Error429TooManyRequests("too many registration attempts")
		}
		if !h.allowAuthAttempt(strings.TrimSpace(strings.ToLower(input.Body.Email)), "register:email", 5, time.Hour) {
			return nil, huma.Error429TooManyRequests("too many registration attempts")
		}

		user, err := h.registerUserWithPolicy(ctx, input.Body.Email, input.Body.Password, acceptedLegal)
		if errors.Is(err, errEmailAlreadyRegistered) {
			return nil, huma.Error409Conflict("email already registered")
		}
		if errors.Is(err, errRegistrationsDisabled) {
			return nil, huma.Error403Forbidden("registrations are disabled for this instance")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create user")
		}

		return h.issueAuthResponse(ctx, user)
	})
}

func (h *AuthHandler) registerUserWithPolicy(ctx context.Context, email, password string, acceptedLegal bool) (*models.User, error) {
	normalizedEmail := strings.TrimSpace(strings.ToLower(email))
	passwordHash, err := h.auth.HashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &models.User{
		ID:           uuid.New().String(),
		Email:        normalizedEmail,
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().UTC(),
	}
	if h.accountPolicy.Required && acceptedLegal {
		user.TermsVersion = h.accountPolicy.TermsVersion
		user.PrivacyVersion = h.accountPolicy.PrivacyVersion
		user.LegalAcceptedAt = user.CreatedAt
	}

	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		// PostgreSQL does not lock an empty users table for COUNT. A transaction-
		// scoped advisory lock serializes only the one-time administrator bootstrap.
		if h.db.Dialect().Name() == dialect.PG {
			if _, err := tx.ExecContext(txCtx, "SELECT pg_advisory_xact_lock(?)", int64(0x4f50454e504f5354)); err != nil {
				return err
			}
		}
		userCount, err := tx.NewSelect().Model((*models.User)(nil)).Count(txCtx)
		if err != nil {
			return err
		}
		if h.registrationsDisabled && userCount > 0 {
			return errRegistrationsDisabled
		}

		exists, err := tx.NewSelect().Model((*models.User)(nil)).
			Where("email = ?", normalizedEmail).
			Exists(txCtx)
		if err != nil {
			return err
		}
		if exists {
			return errEmailAlreadyRegistered
		}

		user.IsAdmin = userCount == 0
		_, err = tx.NewInsert().Model(user).Exec(txCtx)
		return err
	})
	if err != nil {
		return nil, err
	}

	return user, nil
}

func (h *AuthHandler) Login(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "login",
		Method:      http.MethodPost,
		Path:        "/auth/login",
		Summary:     "Login with email and password",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{401},
	}, func(ctx context.Context, input *LoginInput) (*AuthOutput, error) {
		normalizedEmail := strings.TrimSpace(strings.ToLower(input.Body.Email))
		if !h.allowAuthAttempt(clientIP(ctx), "login:ip", 20, 15*time.Minute) {
			return nil, huma.Error429TooManyRequests("too many login attempts")
		}
		if !h.allowAuthAttempt(normalizedEmail, "login:email", 10, 15*time.Minute) {
			return nil, huma.Error429TooManyRequests("too many login attempts")
		}

		user := new(models.User)
		err := h.db.NewSelect().Model(user).
			Where("email = ?", normalizedEmail).
			Scan(ctx)
		if err != nil {
			return nil, huma.Error401Unauthorized("invalid credentials")
		}

		if !h.auth.CheckPassword(input.Body.Password, user.PasswordHash) {
			return nil, huma.Error401Unauthorized("invalid credentials")
		}

		methods, err := h.enabledMFAMethods(ctx, user)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load account security")
		}
		if len(methods) == 0 {
			return h.issueAuthResponse(ctx, user)
		}

		challengeID, err := h.createChallenge(ctx, user.ID, authChallengeLoginMFA, loginChallengePayload{
			Methods: methods,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create login challenge")
		}

		resp := &AuthOutput{}
		resp.Body.RequiresMFA = true
		resp.Body.MFAToken = challengeID
		resp.Body.MFAMethods = methods
		return resp, nil
	})
}

func (h *AuthHandler) Logout(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "logout",
		Method:      http.MethodPost,
		Path:        "/auth/logout",
		Summary:     "Log out the current web session",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{401},
	}, func(ctx context.Context, _ *struct{}) (*LogoutOutput, error) {
		if h.sessions != nil {
			if sessionID := middleware.GetSessionID(ctx); sessionID != "" {
				if err := h.sessions.RevokeSession(ctx, middleware.GetUserID(ctx), sessionID); err != nil && !errors.Is(err, sql.ErrNoRows) {
					return nil, huma.Error500InternalServerError("failed to revoke session")
				}
			}
		}
		out := &LogoutOutput{}
		out.SetCookie = expiredSessionCookie(middleware.IsSecureRequest(ctx)).String()
		out.Body.Message = "logged out"
		return out, nil
	})
}

func (h *AuthHandler) VerifyTOTPLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "verify-login-totp",
		Method:      http.MethodPost,
		Path:        "/auth/login/totp",
		Summary:     "Complete MFA login with a TOTP code",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *VerifyTOTPLoginInput) (*AuthOutput, error) {
		challenge, err := h.getChallenge(ctx, input.Body.MFAToken, authChallengeLoginMFA)
		if err != nil {
			return nil, huma.Error401Unauthorized("invalid or expired MFA token")
		}
		if !h.allowAuthAttempt(clientIP(ctx), "mfa:ip", 20, 15*time.Minute) {
			return nil, huma.Error429TooManyRequests("too many MFA attempts")
		}
		if !h.allowAuthAttempt(challenge.UserID, "mfa:user", 10, 15*time.Minute) {
			return nil, huma.Error429TooManyRequests("too many MFA attempts")
		}

		user, err := h.getUserByID(ctx, challenge.UserID)
		if err != nil {
			return nil, huma.Error401Unauthorized("user not found")
		}

		methods, err := h.enabledMFAMethods(ctx, user)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load account security")
		}
		if !slices.Contains(methods, mfaMethodTOTP) {
			return nil, huma.Error400BadRequest("authenticator app is not enabled for this account")
		}

		secret, err := h.encryptor.Decrypt(user.TOTPSecretEnc)
		if err != nil || !h.mfa.ValidateTOTP(secret, input.Body.Code) {
			return nil, huma.Error401Unauthorized("invalid authenticator code")
		}

		if err := h.deleteChallenge(ctx, challenge.ID); err != nil {
			return nil, huma.Error500InternalServerError("failed to finish MFA login")
		}

		return h.issueAuthResponse(ctx, user)
	})
}

func (h *AuthHandler) allowAuthAttempt(identifier, prefix string, limit int, window time.Duration) bool {
	if h == nil || h.limiter == nil || identifier == "" {
		return true
	}
	return h.limiter.Allow(prefix+":"+identifier, limit, window)
}

func clientIP(ctx context.Context) string {
	if ip := middleware.GetClientIP(ctx); ip != "" {
		return ip
	}
	return "unknown"
}

func (h *AuthHandler) BeginPasskeyLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "begin-login-passkey",
		Method:      http.MethodPost,
		Path:        "/auth/login/passkey/options",
		Summary:     "Begin MFA login with a passkey",
		Tags:        []string{tagAuth},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *BeginPasskeyLoginInput) (*PasskeyCeremonyOutput, error) {
		challenge, err := h.getChallenge(ctx, input.Body.MFAToken, authChallengeLoginMFA)
		if err != nil {
			return nil, huma.Error401Unauthorized("invalid or expired MFA token")
		}

		user, err := h.getUserByID(ctx, challenge.UserID)
		if err != nil {
			return nil, huma.Error401Unauthorized("user not found")
		}

		passkeys, err := h.listPasskeys(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load passkeys")
		}
		if len(passkeys) == 0 {
			return nil, huma.Error400BadRequest("no passkeys registered for this account")
		}

		webAuthnUser, err := mfa.NewWebAuthnUser(user, passkeys)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to prepare passkey login")
		}

		options, session, err := h.mfa.BeginPasskeyLogin(webAuthnUser)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to begin passkey login")
		}

		sessionData, err := mfa.MarshalSessionData(session)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to persist passkey challenge")
		}

		passkeyChallengeID, err := h.createChallenge(ctx, user.ID, authChallengePasskeyLogin, passkeyChallengePayload{
			SessionData: sessionData,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create passkey challenge")
		}

		resp := &PasskeyCeremonyOutput{}
		resp.Body.ChallengeID = passkeyChallengeID
		resp.Body.Options = options
		return resp, nil
	})
}

func (h *AuthHandler) FinishPasskeyLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "finish-login-passkey",
		Method:      http.MethodPost,
		Path:        "/auth/login/passkey/verify",
		Summary:     "Complete MFA login with a passkey",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *FinishPasskeyLoginInput) (*AuthOutput, error) {
		challenge, err := h.getChallenge(ctx, input.Body.ChallengeID, authChallengePasskeyLogin)
		if err != nil {
			return nil, huma.Error401Unauthorized("invalid or expired passkey challenge")
		}

		user, err := h.getUserByID(ctx, challenge.UserID)
		if err != nil {
			return nil, huma.Error401Unauthorized("user not found")
		}

		var payload passkeyChallengePayload
		if err := json.Unmarshal([]byte(challenge.Payload), &payload); err != nil {
			return nil, huma.Error500InternalServerError("failed to read passkey challenge")
		}

		sessionData, err := mfa.UnmarshalSessionData(payload.SessionData)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to restore passkey challenge")
		}

		passkeys, err := h.listPasskeys(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load passkeys")
		}

		webAuthnUser, err := mfa.NewWebAuthnUser(user, passkeys)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to prepare passkey validation")
		}

		credential, err := h.mfa.FinishPasskeyLogin(webAuthnUser, *sessionData, input.Body.Credential)
		if err != nil {
			return nil, huma.Error401Unauthorized("passkey verification failed")
		}

		if err := h.markPasskeyUsed(ctx, user.ID, credential.ID); err != nil {
			return nil, huma.Error500InternalServerError("failed to update passkey state")
		}
		if err := h.deleteChallenge(ctx, challenge.ID); err != nil {
			return nil, huma.Error500InternalServerError("failed to finish passkey login")
		}

		return h.issueAuthResponse(ctx, user)
	})
}

func (h *AuthHandler) Me(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-me",
		Method:      http.MethodGet,
		Path:        "/auth/me",
		Summary:     "Get current authenticated user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
	}, func(ctx context.Context, _ *struct{}) (*MeOutput, error) {
		userID := middleware.GetUserID(ctx)

		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}

		return &MeOutput{Body: h.toUserProfile(user)}, nil
	})
}

func (h *AuthHandler) UpdateProfile(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-profile",
		Method:      http.MethodPatch,
		Path:        "/auth/profile",
		Summary:     "Update current user profile",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *UpdateProfileInput) (*MeOutput, error) {
		userID := middleware.GetUserID(ctx)

		update := h.db.NewUpdate().Model((*models.User)(nil)).Where("id = ?", userID)
		hasChange := false
		if input.Body.DisplayName != nil {
			displayName := strings.TrimSpace(*input.Body.DisplayName)
			if len(displayName) > 120 {
				return nil, huma.Error400BadRequest("display name must be at most 120 characters")
			}
			update = update.Set("display_name = ?", displayName)
			hasChange = true
		}
		if input.Body.AvatarURL != nil {
			avatarURL := strings.TrimSpace(*input.Body.AvatarURL)
			if len(avatarURL) > 1000 {
				return nil, huma.Error400BadRequest("avatar url must be at most 1000 characters")
			}
			update = update.Set("avatar_url = ?", avatarURL)
			hasChange = true
		}
		if hasChange {
			if _, err := update.Exec(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to update profile")
			}
		}

		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		return &MeOutput{Body: h.toUserProfile(user)}, nil
	})
}

func (h *AuthHandler) SecurityStatus(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-security-status",
		Method:      http.MethodGet,
		Path:        "/auth/security",
		Summary:     "Get account security settings",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
	}, func(ctx context.Context, _ *struct{}) (*SecurityStatusOutput, error) {
		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}

		passkeys, err := h.listPasskeys(ctx, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load passkeys")
		}

		methods, err := h.enabledMFAMethods(ctx, user)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load security methods")
		}

		resp := &SecurityStatusOutput{}
		resp.Body.User = h.toUserProfile(user)
		resp.Body.TOTPEnabled = len(user.TOTPSecretEnc) > 0
		resp.Body.Passkeys = toPasskeySummaries(passkeys)
		resp.Body.Methods = methods
		return resp, nil
	})
}

func (h *AuthHandler) ListSessions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-auth-sessions",
		Method:      http.MethodGet,
		Path:        "/auth/sessions",
		Summary:     "List active web sessions",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{403},
	}, func(ctx context.Context, _ *struct{}) (*ListUserSessionsOutput, error) {
		currentSessionID := middleware.GetSessionID(ctx)
		if h.sessions == nil || currentSessionID == "" {
			return nil, huma.Error403Forbidden("web session token required")
		}

		items, err := h.sessions.ListActiveSessions(ctx, middleware.GetUserID(ctx))
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list sessions")
		}

		return &ListUserSessionsOutput{Body: userSessionSummaries(items, currentSessionID)}, nil
	})
}

func (h *AuthHandler) RevokeSession(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "revoke-auth-session",
		Method:      http.MethodDelete,
		Path:        "/auth/sessions/{session_id}",
		Summary:     "Revoke an active web session",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *RevokeUserSessionInput) (*RevokeUserSessionOutput, error) {
		currentSessionID := middleware.GetSessionID(ctx)
		if h.sessions == nil || currentSessionID == "" {
			return nil, huma.Error403Forbidden("web session token required")
		}

		if err := h.sessions.RevokeSession(ctx, middleware.GetUserID(ctx), input.SessionID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("session not found")
			}
			return nil, huma.Error500InternalServerError("failed to revoke session")
		}

		output := &RevokeUserSessionOutput{}
		output.Body.Revoked = true
		output.Body.RevokedCurrent = input.SessionID == currentSessionID
		return output, nil
	})
}

func (h *AuthHandler) BeginTOTPSetup(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "begin-totp-setup",
		Method:      http.MethodPost,
		Path:        "/auth/security/totp/setup",
		Summary:     "Start TOTP enrollment for the current user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401, 409},
	}, func(ctx context.Context, input *SetupTOTPInput) (*SetupTOTPOutput, error) {
		if strings.TrimSpace(input.Body.CurrentPassword) == "" {
			return nil, huma.Error400BadRequest(passwordReauthError)
		}

		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if len(user.TOTPSecretEnc) > 0 {
			return nil, huma.Error409Conflict("authenticator app is already enabled")
		}
		if !h.auth.CheckPassword(input.Body.CurrentPassword, user.PasswordHash) {
			return nil, huma.Error401Unauthorized("invalid current password")
		}

		key, qrPNG, err := h.mfa.GenerateTOTP(user.Email)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to generate authenticator secret")
		}

		secretEnc, err := h.encryptor.Encrypt(key.Secret())
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to protect authenticator secret")
		}

		challengeID, err := h.createChallenge(ctx, user.ID, authChallengeTOTPSetup, totpSetupPayload{
			SecretEncrypted: base64.StdEncoding.EncodeToString(secretEnc),
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create setup challenge")
		}

		resp := &SetupTOTPOutput{}
		resp.Body.ChallengeID = challengeID
		resp.Body.ManualEntryKey = key.Secret()
		resp.Body.OTPAuthURL = key.URL()
		resp.Body.QRCodeDataURL = "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrPNG)
		return resp, nil
	})
}

func (h *AuthHandler) ConfirmTOTPSetup(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "confirm-totp-setup",
		Method:      http.MethodPost,
		Path:        "/auth/security/totp/confirm",
		Summary:     "Confirm TOTP enrollment with a verification code",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *ConfirmTOTPSetupInput) (*SecurityStatusOutput, error) {
		challenge, err := h.getChallenge(ctx, input.Body.ChallengeID, authChallengeTOTPSetup)
		if err != nil {
			return nil, huma.Error401Unauthorized("invalid or expired setup challenge")
		}
		if challenge.UserID != middleware.GetUserID(ctx) {
			return nil, huma.Error401Unauthorized("invalid setup challenge")
		}

		var payload totpSetupPayload
		if err := json.Unmarshal([]byte(challenge.Payload), &payload); err != nil {
			return nil, huma.Error500InternalServerError("failed to read setup challenge")
		}

		secret, err := h.resolveTOTPSetupSecret(payload)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to read setup challenge")
		}
		if !h.mfa.ValidateTOTP(secret, input.Body.Code) {
			return nil, huma.Error400BadRequest("invalid authenticator code")
		}

		secretEnc, err := h.encryptor.Encrypt(secret)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to save authenticator secret")
		}

		if _, err := h.db.NewUpdate().Model((*models.User)(nil)).
			Set("totp_secret_encrypted = ?", secretEnc).
			Set("totp_enabled_at = ?", time.Now().UTC()).
			Where("id = ?", challenge.UserID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to enable authenticator app")
		}
		if err := h.deleteChallenge(ctx, challenge.ID); err != nil {
			return nil, huma.Error500InternalServerError("failed to finish setup")
		}

		return h.securityStatusResponse(ctx, challenge.UserID)
	})
}

func (h *AuthHandler) DisableTOTP(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "disable-totp",
		Method:      http.MethodPost,
		Path:        "/auth/security/totp/disable",
		Summary:     "Disable TOTP for the current user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *DisableTOTPInput) (*SecurityStatusOutput, error) {
		if strings.TrimSpace(input.Body.CurrentPassword) == "" {
			return nil, huma.Error400BadRequest(passwordReauthError)
		}

		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if !h.auth.CheckPassword(input.Body.CurrentPassword, user.PasswordHash) {
			return nil, huma.Error401Unauthorized("invalid current password")
		}

		if _, err := h.db.NewUpdate().Model((*models.User)(nil)).
			Set("totp_secret_encrypted = NULL").
			Set("totp_enabled_at = NULL").
			Where("id = ?", userID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to disable authenticator app")
		}

		return h.securityStatusResponse(ctx, userID)
	})
}

func (h *AuthHandler) BeginPasskeyRegistration(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "begin-passkey-registration",
		Method:      http.MethodPost,
		Path:        "/auth/security/passkeys/begin",
		Summary:     "Begin passkey registration for the current user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *BeginPasskeyRegistrationInput) (*PasskeyCeremonyOutput, error) {
		if strings.TrimSpace(input.Body.CurrentPassword) == "" {
			return nil, huma.Error400BadRequest(passwordReauthError)
		}

		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if !h.auth.CheckPassword(input.Body.CurrentPassword, user.PasswordHash) {
			return nil, huma.Error401Unauthorized("invalid current password")
		}

		passkeys, err := h.listPasskeys(ctx, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load passkeys")
		}

		webAuthnUser, err := mfa.NewWebAuthnUser(user, passkeys)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to prepare passkey registration")
		}

		options, session, err := h.mfa.BeginPasskeyRegistration(webAuthnUser)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to begin passkey registration")
		}

		sessionData, err := mfa.MarshalSessionData(session)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to persist passkey registration")
		}

		challengeID, err := h.createChallenge(ctx, userID, authChallengePasskeySetup, passkeyChallengePayload{
			SessionData: sessionData,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create passkey registration challenge")
		}

		resp := &PasskeyCeremonyOutput{}
		resp.Body.ChallengeID = challengeID
		resp.Body.Options = options
		return resp, nil
	})
}

func (h *AuthHandler) FinishPasskeyRegistration(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "finish-passkey-registration",
		Method:      http.MethodPost,
		Path:        "/auth/security/passkeys/finish",
		Summary:     "Finish passkey registration for the current user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *FinishPasskeyRegistrationInput) (*SecurityStatusOutput, error) {
		challenge, err := h.getChallenge(ctx, input.Body.ChallengeID, authChallengePasskeySetup)
		if err != nil {
			return nil, huma.Error401Unauthorized("invalid or expired passkey challenge")
		}
		if challenge.UserID != middleware.GetUserID(ctx) {
			return nil, huma.Error401Unauthorized("invalid passkey challenge")
		}

		user, err := h.getUserByID(ctx, challenge.UserID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}

		var payload passkeyChallengePayload
		if err := json.Unmarshal([]byte(challenge.Payload), &payload); err != nil {
			return nil, huma.Error500InternalServerError("failed to read passkey challenge")
		}

		sessionData, err := mfa.UnmarshalSessionData(payload.SessionData)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to restore passkey challenge")
		}

		passkeys, err := h.listPasskeys(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load passkeys")
		}

		webAuthnUser, err := mfa.NewWebAuthnUser(user, passkeys)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to prepare passkey registration")
		}

		credential, err := h.mfa.FinishPasskeyRegistration(webAuthnUser, *sessionData, input.Body.Credential)
		if err != nil {
			return nil, huma.Error400BadRequest(fmt.Sprintf("passkey registration failed: %s", err.Error()))
		}

		credentialJSON, err := json.Marshal(credential)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to save passkey")
		}

		name := strings.TrimSpace(input.Body.Name)
		if name == "" {
			name = defaultPasskeyDisplayName
		}

		record := &models.UserPasskey{
			ID:             uuid.New().String(),
			UserID:         user.ID,
			Name:           name,
			CredentialID:   credential.ID,
			CredentialJSON: string(credentialJSON),
			CreatedAt:      time.Now().UTC(),
		}

		if _, err := h.db.NewInsert().Model(record).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to store passkey")
		}
		if _, err := h.db.NewUpdate().Model((*models.User)(nil)).
			Set("passkey_enabled_at = ?", time.Now().UTC()).
			Where("id = ?", user.ID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to update account security")
		}
		if err := h.deleteChallenge(ctx, challenge.ID); err != nil {
			return nil, huma.Error500InternalServerError("failed to finish passkey registration")
		}

		return h.securityStatusResponse(ctx, user.ID)
	})
}

func (h *AuthHandler) RemovePasskey(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "remove-passkey",
		Method:      http.MethodPost,
		Path:        "/auth/security/passkeys/{passkey_id}/remove",
		Summary:     "Remove a passkey from the current user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401, 404},
	}, func(ctx context.Context, input *RemovePasskeyInput) (*SecurityStatusOutput, error) {
		if strings.TrimSpace(input.Body.CurrentPassword) == "" {
			return nil, huma.Error400BadRequest(passwordReauthError)
		}

		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if !h.auth.CheckPassword(input.Body.CurrentPassword, user.PasswordHash) {
			return nil, huma.Error401Unauthorized("invalid current password")
		}

		result, err := h.db.NewDelete().Model((*models.UserPasskey)(nil)).
			Where("id = ? AND user_id = ?", input.PasskeyID, userID).
			Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to remove passkey")
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return nil, huma.Error404NotFound("passkey not found")
		}

		var remaining int
		remaining, err = h.db.NewSelect().Model((*models.UserPasskey)(nil)).
			Where("user_id = ?", userID).
			Count(ctx)
		if err == nil && remaining == 0 {
			_, _ = h.db.NewUpdate().Model((*models.User)(nil)).
				Set("passkey_enabled_at = NULL").
				Where("id = ?", userID).
				Exec(ctx)
		}

		return h.securityStatusResponse(ctx, userID)
	})
}

func (h *AuthHandler) getUserByID(ctx context.Context, userID string) (*models.User, error) {
	user := new(models.User)
	if err := h.db.NewSelect().Model(user).Where("id = ?", userID).Scan(ctx); err != nil {
		return nil, err
	}
	return user, nil
}

func (h *AuthHandler) issueAuthResponse(ctx context.Context, user *models.User) (*AuthOutput, error) {
	expiresAt := time.Now().UTC().Add(auth.TokenTTL)
	sessionID := ""
	if h.sessions != nil {
		session, err := h.sessions.CreateSession(ctx, sessions.CreateInput{
			UserID:    user.ID,
			UserAgent: middleware.GetUserAgent(ctx),
			IPAddress: middleware.GetClientIP(ctx),
			ExpiresAt: expiresAt,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create session")
		}
		sessionID = session.ID
	}

	token, err := h.auth.GenerateTokenWithSession(user.ID, user.Email, sessionID, expiresAt)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to generate token")
	}

	resp := &AuthOutput{}
	resp.Body.Token = token
	resp.Body.User = h.toUserProfile(user)
	resp.SetCookie = sessionCookie(token, expiresAt, middleware.IsSecureRequest(ctx)).String()
	return resp, nil
}

func sessionCookie(token string, expiresAt time.Time, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     "openpost_session",
		Value:    token,
		Path:     "/",
		Expires:  expiresAt.UTC(),
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
}

func expiredSessionCookie(secure bool) *http.Cookie {
	cookie := sessionCookie("", time.Unix(1, 0), secure)
	cookie.MaxAge = -1
	return cookie
}

func (h *AuthHandler) enabledMFAMethods(ctx context.Context, user *models.User) ([]string, error) {
	methods := make([]string, 0, 2)
	if len(user.TOTPSecretEnc) > 0 {
		methods = append(methods, mfaMethodTOTP)
	}

	count, err := h.db.NewSelect().Model((*models.UserPasskey)(nil)).
		Where("user_id = ?", user.ID).
		Count(ctx)
	if err != nil {
		return nil, err
	}
	if count > 0 {
		methods = append(methods, mfaMethodPasskey)
	}
	return methods, nil
}

func (h *AuthHandler) createChallenge(ctx context.Context, userID, challengeType string, payload interface{}) (string, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	record := &models.AuthChallenge{
		ID:        uuid.New().String(),
		UserID:    userID,
		Type:      challengeType,
		Payload:   string(payloadBytes),
		ExpiresAt: mfa.ChallengeExpiry(),
		CreatedAt: time.Now().UTC(),
	}
	if _, err := h.db.NewInsert().Model(record).Exec(ctx); err != nil {
		return "", err
	}
	return record.ID, nil
}

func (h *AuthHandler) getChallenge(ctx context.Context, challengeID, challengeType string) (*models.AuthChallenge, error) {
	challenge := new(models.AuthChallenge)
	err := h.db.NewSelect().Model(challenge).
		Where("id = ? AND type = ?", challengeID, challengeType).
		Scan(ctx)
	if err != nil {
		return nil, err
	}
	if time.Now().UTC().After(challenge.ExpiresAt) {
		_ = h.deleteChallenge(ctx, challenge.ID)
		return nil, fmt.Errorf("challenge expired")
	}
	return challenge, nil
}

func (h *AuthHandler) deleteChallenge(ctx context.Context, challengeID string) error {
	_, err := h.db.NewDelete().Model((*models.AuthChallenge)(nil)).Where("id = ?", challengeID).Exec(ctx)
	return err
}

func (h *AuthHandler) resolveTOTPSetupSecret(payload totpSetupPayload) (string, error) {
	if payload.SecretEncrypted != "" {
		secretEnc, err := base64.StdEncoding.DecodeString(payload.SecretEncrypted)
		if err != nil {
			return "", err
		}
		return h.encryptor.Decrypt(secretEnc)
	}
	return payload.Secret, nil
}

func (h *AuthHandler) listPasskeys(ctx context.Context, userID string) ([]models.UserPasskey, error) {
	var passkeys []models.UserPasskey
	if err := h.db.NewSelect().Model(&passkeys).
		Where("user_id = ?", userID).
		Order("created_at ASC").
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return []models.UserPasskey{}, nil
		}
		return nil, err
	}
	return passkeys, nil
}

func (h *AuthHandler) markPasskeyUsed(ctx context.Context, userID string, credentialID []byte) error {
	_, err := h.db.NewUpdate().Model((*models.UserPasskey)(nil)).
		Set("last_used_at = ?", time.Now().UTC()).
		Where("user_id = ? AND credential_id = ?", userID, credentialID).
		Exec(ctx)
	return err
}

func (h *AuthHandler) securityStatusResponse(ctx context.Context, userID string) (*SecurityStatusOutput, error) {
	user, err := h.getUserByID(ctx, userID)
	if err != nil {
		return nil, huma.Error404NotFound("user not found")
	}

	passkeys, err := h.listPasskeys(ctx, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load passkeys")
	}

	methods, err := h.enabledMFAMethods(ctx, user)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load account security")
	}

	resp := &SecurityStatusOutput{}
	resp.Body.User = h.toUserProfile(user)
	resp.Body.TOTPEnabled = len(user.TOTPSecretEnc) > 0
	resp.Body.Passkeys = toPasskeySummaries(passkeys)
	resp.Body.Methods = methods
	return resp, nil
}

func (h *AuthHandler) toUserProfile(user *models.User) *UserProfile {
	return &UserProfile{
		ID:              user.ID,
		Email:           user.Email,
		DisplayName:     user.DisplayName,
		AvatarURL:       user.AvatarURL,
		IsAdmin:         user.IsAdmin,
		TermsVersion:    user.TermsVersion,
		PrivacyVersion:  user.PrivacyVersion,
		LegalAcceptedAt: user.LegalAcceptedAt,
		LegalAcceptanceRequired: h.accountPolicy.Required &&
			(user.LegalAcceptedAt.IsZero() ||
				user.TermsVersion != h.accountPolicy.TermsVersion ||
				user.PrivacyVersion != h.accountPolicy.PrivacyVersion),
		CreatedAt: user.CreatedAt,
	}
}

func toPasskeySummaries(passkeys []models.UserPasskey) []PasskeySummary {
	items := make([]PasskeySummary, 0, len(passkeys))
	for _, passkey := range passkeys {
		items = append(items, PasskeySummary{
			ID:         passkey.ID,
			Name:       passkey.Name,
			CreatedAt:  passkey.CreatedAt,
			LastUsedAt: passkey.LastUsedAt,
		})
	}
	return items
}

func userSessionSummaries(items []models.UserSession, currentSessionID string) []UserSessionSummary {
	out := make([]UserSessionSummary, 0, len(items))
	for _, session := range items {
		out = append(out, UserSessionSummary{
			ID:         session.ID,
			UserAgent:  session.UserAgent,
			DeviceName: summarizeUserAgent(session.UserAgent),
			IPAddress:  session.IPAddress,
			Current:    session.ID == currentSessionID,
			ExpiresAt:  session.ExpiresAt,
			LastUsedAt: session.LastUsedAt,
			CreatedAt:  session.CreatedAt,
		})
	}
	return out
}

func summarizeUserAgent(userAgent string) string {
	ua := strings.TrimSpace(userAgent)
	if ua == "" {
		return "Unknown browser"
	}

	return browserName(ua) + " on " + deviceName(ua)
}

func browserName(ua string) string {
	browser := "Browser"
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/") || strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/") || strings.Contains(ua, "CriOS/"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	return browser
}

func deviceName(ua string) string {
	device := "device"
	switch {
	case strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X"):
		device = "MacBook"
	case strings.Contains(ua, "Windows"):
		device = "Windows"
	case strings.Contains(ua, "iPhone"):
		device = "iPhone"
	case strings.Contains(ua, "iPad"):
		device = "iPad"
	case strings.Contains(ua, "Android"):
		device = "Android"
	case strings.Contains(ua, "Linux"):
		device = "Linux"
	}
	return device
}
