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
	"github.com/openpost/backend/internal/publicprofiles"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/billing"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/emailverification"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/mfa"
	"github.com/openpost/backend/internal/services/mfarecovery"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/openpost/backend/internal/usernames"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	authChallengeLoginMFA      = "login_mfa"
	authChallengeTOTPSetup     = "totp_setup"
	authChallengeTOTPRecovery  = "totp_recovery_regeneration"
	authChallengePasskeySetup  = "passkey_setup"
	authChallengePasskeyLogin  = "passkey_login"
	authChallengePasskeyReauth = "passkey_reauth"
	mfaMethodTOTP              = "totp"
	mfaMethodPasskey           = "passkey"
	mfaMethodRecoveryCode      = "recovery_code"
	defaultPasskeyDisplayName  = "Unnamed passkey"
	reauthActionTOTPSetup      = "security.totp.setup"
	reauthActionTOTPDisable    = "security.totp.disable"
	reauthActionRecoveryStatus = "security.totp.recovery.inspect"
	reauthActionRecoveryReset  = "security.totp.recovery.regenerate"
	reauthActionPasskeyAdd     = "security.passkey.add"
	reauthActionPasskeyRemove  = "security.passkey.remove"
	reauthActionPassword       = "security.password.change"
)

type AuthHandler struct {
	db                        *bun.DB
	auth                      *auth.Service
	authenticator             middleware.Authenticator
	sessions                  *sessions.Service
	encryptor                 *crypto.TokenEncryptor
	mfa                       *mfa.Service
	mfaRecovery               *mfarecovery.Service
	registrationsDisabled     bool
	publicProfilesEnabled     bool
	limiter                   *ratelimit.Limiter
	passwordResetSender       passwordmail.Sender
	emailVerification         *emailverification.Service
	emailSender               passwordmail.Sender
	emailVerificationRequired bool
	publicURL                 string
	accountPolicy             AccountPolicy
	identity                  *identity.Service
	purchaseChoices           *billing.Service
	purchaseChoiceRequired    bool
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
		mfaRecovery:           mfarecovery.NewService(db),
		registrationsDisabled: registrationsDisabled,
		publicProfilesEnabled: true,
		limiter:               ratelimit.New(),
	}
}

func (h *AuthHandler) SetPublicProfilesEnabled(enabled bool) {
	h.publicProfilesEnabled = enabled
}

func (h *AuthHandler) SetSessionService(sessionService *sessions.Service) {
	h.sessions = sessionService
}

func (h *AuthHandler) SetPasswordResetSender(sender passwordmail.Sender, publicURL string) {
	h.passwordResetSender = sender
	h.publicURL = strings.TrimRight(strings.TrimSpace(publicURL), "/")
}

func (h *AuthHandler) SetEmailVerification(
	service *emailverification.Service,
	sender passwordmail.Sender,
	required bool,
) {
	h.emailVerification = service
	h.emailSender = sender
	h.emailVerificationRequired = required
}

func (h *AuthHandler) SetAccountPolicy(policy AccountPolicy) {
	h.accountPolicy = policy.normalized()
}

func (h *AuthHandler) SetIdentityService(service *identity.Service) {
	h.identity = service
}

func (h *AuthHandler) SetPurchaseChoices(service *billing.Service, required bool) {
	h.purchaseChoices = service
	h.purchaseChoiceRequired = required
}

var (
	errEmailAlreadyRegistered    = errors.New("email already registered")
	errUsernameAlreadyRegistered = errors.New("username already registered")
	errRegistrationsDisabled     = errors.New("registrations are disabled for this instance")
)

type RegisterInput struct {
	Body struct {
		Email               string `json:"email" format:"email" doc:"User email address"`
		Username            string `json:"username,omitempty" minLength:"3" maxLength:"30" pattern:"^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$" doc:"Optional unique public username; OpenPost creates one from the email when omitted"`
		Password            string `json:"password" minLength:"12" maxLength:"1024" doc:"User password (min 12 characters)"`
		AcceptedLegal       *bool  `json:"accepted_legal,omitempty" doc:"Whether the user accepted the current terms and privacy policy"`
		PurchaseChoiceToken string `json:"purchase_choice_token,omitempty" doc:"Integrity-protected hosted plan and billing-period choice; required for hosted registration"`
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

type VerifyRecoveryCodeLoginInput struct {
	Body struct {
		MFAToken string `json:"mfa_token" doc:"Pending MFA challenge token"`
		Code     string `json:"code" minLength:"16" maxLength:"32" doc:"Single-use MFA recovery code"`
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

type BeginPasskeyReauthInput struct {
	Body struct {
		Action string `json:"action" minLength:"1" doc:"Sensitive action the one-time grant authorizes"`
	}
}

type FinishPasskeyReauthInput struct {
	Body struct {
		ChallengeID string          `json:"challenge_id" doc:"Passkey challenge ID"`
		Credential  json.RawMessage `json:"credential" doc:"WebAuthn assertion response"`
	}
}

type SetupTOTPInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
	}
}

type ConfirmTOTPSetupInput struct {
	Body struct {
		ChallengeID string `json:"challenge_id" doc:"TOTP setup challenge ID"`
		Code        string `json:"code" minLength:"6" maxLength:"6" doc:"Six digit authenticator code"`
	}
}

type AcknowledgeRecoveryCodesInput struct {
	Body struct {
		ChallengeID        string `json:"challenge_id" doc:"Recovery-code challenge ID"`
		RecoveryCodesSaved bool   `json:"recovery_codes_saved" doc:"Explicit acknowledgement that the one-time recovery codes were saved"`
	}
}

type RecoveryCodeSensitiveActionInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
	}
}

type DisableTOTPInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
	}
}

type BeginPasskeyRegistrationInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password for re-authentication"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
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
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
	}
}

type UserProfile struct {
	ID                         string    `json:"id" doc:"User ID"`
	Email                      string    `json:"email" doc:"User email address"`
	Username                   string    `json:"username" doc:"Unique public username"`
	DisplayName                string    `json:"display_name" doc:"User display name"`
	AvatarURL                  string    `json:"avatar_url" doc:"Profile avatar URL"`
	PublicProfileEnabled       bool      `json:"public_profile_enabled" doc:"Whether the public activity profile is visible"`
	PublicProfileVisibleFields []string  `json:"public_profile_visible_fields" doc:"Optional account fields visible while the public profile is enabled"`
	ComposerExperience         string    `json:"composer_experience" enum:"specialized,unified" doc:"Preferred composer experience"`
	IsAdmin                    bool      `json:"is_admin" doc:"Whether this user can manage instance-level settings"`
	TermsVersion               string    `json:"terms_version,omitempty" doc:"Terms version accepted by the user"`
	PrivacyVersion             string    `json:"privacy_version,omitempty" doc:"Privacy version acknowledged by the user"`
	LegalAcceptedAt            time.Time `json:"legal_accepted_at,omitempty" doc:"When the current account policy was accepted"`
	LegalAcceptanceRequired    bool      `json:"legal_acceptance_required" doc:"Whether the current hosted policy still needs acceptance"`
	CreatedAt                  time.Time `json:"created_at" doc:"Account creation time"`
	EmailVerified              bool      `json:"email_verified" doc:"Whether the account email address is verified"`
	HasPassword                bool      `json:"has_password" doc:"Whether this account has a local password credential"`
	PasswordUsable             bool      `json:"password_usable" doc:"Whether the local password can currently be used for sign-in and sensitive-action reauthentication"`
	IsManaged                  bool      `json:"is_managed" doc:"Whether this account was provisioned by an organization identity provider"`
	ManagedOrganizationName    string    `json:"managed_organization_name,omitempty" doc:"Organization managing this account"`
}

type UpdateProfileInputBody struct {
	Username                   *string   `json:"username,omitempty" minLength:"3" maxLength:"30" doc:"Unique public username"`
	DisplayName                *string   `json:"display_name,omitempty" maxLength:"120" doc:"User display name"`
	AvatarURL                  *string   `json:"avatar_url,omitempty" maxLength:"1000" doc:"Profile avatar URL"`
	PublicProfileEnabled       *bool     `json:"public_profile_enabled,omitempty" doc:"Whether the public activity profile is visible"`
	PublicProfileVisibleFields *[]string `json:"public_profile_visible_fields,omitempty" doc:"Optional public-profile fields: display_name, avatar, joined_at, activity, platforms, workspaces, plan"`
	ComposerExperience         *string   `json:"composer_experience,omitempty" enum:"specialized,unified" doc:"Preferred composer experience"`
}

type UpdateProfileInput struct {
	Body UpdateProfileInputBody
}

type AuthOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		Token                     string       `json:"token,omitempty" doc:"JWT authentication token"`
		User                      *UserProfile `json:"user,omitempty"`
		RequiresMFA               bool         `json:"requires_mfa" doc:"Whether the login requires a second factor"`
		MFAToken                  string       `json:"mfa_token,omitempty" doc:"Pending MFA token for follow-up verification"`
		MFAMethods                []string     `json:"mfa_methods,omitempty" doc:"MFA verification methods available for this login challenge"`
		RequiresEmailVerification bool         `json:"requires_email_verification" doc:"Whether a six-digit email code must be confirmed before sign-in"`
		EmailVerificationID       string       `json:"email_verification_id,omitempty" doc:"Opaque email verification challenge ID"`
		EmailVerificationEmail    string       `json:"email_verification_email,omitempty" doc:"Email address receiving the verification code"`
		EmailDeliveryStatus       string       `json:"email_delivery_status,omitempty" enum:"sent,failed" doc:"Whether the latest verification email delivery request succeeded"`
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

type AuthSessionStateOutput struct {
	Body struct {
		Authenticated bool         `json:"authenticated" doc:"Whether the request has a valid OpenPost session"`
		User          *UserProfile `json:"user,omitempty"`
	}
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
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		ChallengeID    string `json:"challenge_id"`
		ManualEntryKey string `json:"manual_entry_key"`
		OTPAuthURL     string `json:"otpauth_url"`
		QRCodeDataURL  string `json:"qr_code_data_url"`
	}
}

type RecoveryCodeSetOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		ChallengeID   string   `json:"challenge_id" doc:"Expiring challenge that activates this code set after acknowledgement"`
		RecoveryCodes []string `json:"recovery_codes" doc:"One-time plaintext recovery codes; these are never returned again"`
	}
}

type RecoveryCodeStatusOutput struct {
	Body struct {
		Remaining int `json:"remaining" doc:"Number of unused active MFA recovery codes"`
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
	Secret             string   `json:"secret,omitempty"`
	SecretEncrypted    string   `json:"secret_encrypted,omitempty"`
	RecoveryBatchID    string   `json:"recovery_batch_id,omitempty"`
	RecoveryCodeHashes []string `json:"recovery_code_hashes,omitempty"`
}

type recoveryCodeChallengePayload struct {
	BatchID string   `json:"batch_id"`
	Hashes  []string `json:"hashes"`
}

type passkeyChallengePayload struct {
	SessionData string `json:"session_data"`
	SessionID   string `json:"session_id,omitempty"`
	Action      string `json:"action,omitempty"`
}

func (h *AuthHandler) Register(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "register",
		Method:      http.MethodPost,
		Path:        "/auth/register",
		Summary:     "Register a new user",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 403, 409, 429, 503},
	}, h.handleRegister)
}

func (h *AuthHandler) handleRegister(ctx context.Context, input *RegisterInput) (*AuthOutput, error) {
	acceptedLegal, err := h.validateRegistrationRequest(ctx, input)
	if err != nil {
		return nil, err
	}
	user, err := h.registerUserWithPolicy(
		ctx,
		input.Body.Email,
		input.Body.Username,
		input.Body.Password,
		acceptedLegal,
	)
	if err != nil {
		return nil, registrationHTTPError(err)
	}
	if h.emailVerificationRequired {
		return h.beginEmailVerification(ctx, user, true)
	}
	return h.issueAuthResponse(ctx, user)
}

func (h *AuthHandler) validateRegistrationRequest(ctx context.Context, input *RegisterInput) (bool, error) {
	if _, err := h.resolvePurchaseChoice(input.Body.PurchaseChoiceToken, "", ""); err != nil {
		return false, err
	}
	if h.emailVerificationRequired && (h.emailVerification == nil || h.emailSender == nil) {
		return false, huma.Error503ServiceUnavailable("email verification is not configured for this instance")
	}
	if err := validateNewPassword(input.Body.Password); err != nil {
		return false, huma.Error400BadRequest(err.Error())
	}
	if username := usernames.Normalize(input.Body.Username); username != "" {
		if err := usernames.Validate(username); err != nil {
			return false, huma.Error400BadRequest(err.Error())
		}
	}
	acceptedLegal := input.Body.AcceptedLegal != nil && *input.Body.AcceptedLegal
	if h.accountPolicy.Required && !acceptedLegal {
		return false, huma.Error400BadRequest("accept the Terms of Service and Privacy Policy to continue")
	}
	if !h.allowAuthAttempt(clientIP(ctx), "register:ip", 10, time.Hour) {
		return false, huma.Error429TooManyRequests("too many registration attempts")
	}
	normalizedEmail := strings.TrimSpace(strings.ToLower(input.Body.Email))
	if !h.allowAuthAttempt(normalizedEmail, "register:email", 5, time.Hour) {
		return false, huma.Error429TooManyRequests("too many registration attempts")
	}
	return acceptedLegal, nil
}

func (h *AuthHandler) resolvePurchaseChoice(token, expectedPlanID, expectedBillingPeriod string) (billing.PurchaseChoice, error) {
	if !h.purchaseChoiceRequired {
		return billing.PurchaseChoice{}, nil
	}
	if h.purchaseChoices == nil {
		return billing.PurchaseChoice{}, huma.Error503ServiceUnavailable("purchase choices are not configured for this instance")
	}
	choice, err := h.purchaseChoices.ResolvePurchaseChoice(token, expectedPlanID, expectedBillingPeriod)
	if err != nil {
		return billing.PurchaseChoice{}, purchaseChoiceAPIError(err)
	}
	return choice, nil
}

func registrationHTTPError(err error) error {
	switch {
	case errors.Is(err, errEmailAlreadyRegistered):
		return huma.Error409Conflict("email already registered")
	case errors.Is(err, errUsernameAlreadyRegistered):
		return huma.Error409Conflict("username already registered")
	case errors.Is(err, errRegistrationsDisabled):
		return huma.Error403Forbidden("registrations are disabled for this instance")
	default:
		return huma.Error500InternalServerError("failed to create user")
	}
}

func (h *AuthHandler) registerUserWithPolicy(ctx context.Context, email, username, password string, acceptedLegal bool) (*models.User, error) {
	normalizedEmail := strings.TrimSpace(strings.ToLower(email))
	normalizedUsername := usernames.Normalize(username)
	userID := uuid.New().String()
	if normalizedUsername == "" {
		normalizedUsername = usernames.Candidate(usernames.Suggest("", normalizedEmail), userID, 1)
	}
	if err := usernames.Validate(normalizedUsername); err != nil {
		return nil, err
	}
	passwordHash, err := h.auth.HashPassword(password)
	if err != nil {
		return nil, err
	}

	createdAt := time.Now().UTC()
	user := &models.User{
		ID:           userID,
		Email:        normalizedEmail,
		Username:     normalizedUsername,
		PasswordHash: passwordHash,
		CreatedAt:    createdAt,
	}
	if !h.emailVerificationRequired {
		user.EmailVerifiedAt = createdAt
	}
	if h.accountPolicy.Required && acceptedLegal {
		user.TermsVersion = h.accountPolicy.TermsVersion
		user.PrivacyVersion = h.accountPolicy.PrivacyVersion
		user.LegalAcceptedAt = user.CreatedAt
	}

	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return h.insertRegistrationUser(txCtx, tx, user)
	})
	if err != nil {
		return nil, err
	}

	return user, nil
}

func (h *AuthHandler) insertRegistrationUser(ctx context.Context, tx bun.Tx, user *models.User) error {
	// PostgreSQL does not lock an empty users table for COUNT. A transaction-
	// scoped advisory lock serializes only the one-time administrator bootstrap.
	if h.db.Dialect().Name() == dialect.PG {
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(?)", int64(0x4f50454e504f5354)); err != nil {
			return err
		}
	}
	userCount, err := tx.NewSelect().Model((*models.User)(nil)).Count(ctx)
	if err != nil {
		return err
	}
	if h.registrationsDisabled && userCount > 0 {
		return errRegistrationsDisabled
	}
	if err := ensureRegistrationIdentityAvailable(ctx, tx, user.Email, user.Username); err != nil {
		return err
	}
	user.IsAdmin = userCount == 0 && !h.emailVerificationRequired
	_, err = tx.NewInsert().Model(user).Exec(ctx)
	return registrationInsertError(err)
}

func ensureRegistrationIdentityAvailable(ctx context.Context, tx bun.Tx, email, username string) error {
	emailExists, err := tx.NewSelect().Model((*models.User)(nil)).
		Where("email = ?", email).
		Exists(ctx)
	if err != nil {
		return err
	}
	if emailExists {
		return errEmailAlreadyRegistered
	}
	usernameExists, err := tx.NewSelect().Model((*models.User)(nil)).
		Where("LOWER(username) = ?", username).
		Exists(ctx)
	if err != nil {
		return err
	}
	if usernameExists {
		return errUsernameAlreadyRegistered
	}
	return nil
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
		if h.identity != nil {
			allowed, policyErr := h.identity.PasswordCredentialAllowed(ctx, user.ID)
			if policyErr != nil {
				return nil, huma.Error500InternalServerError("failed to evaluate sign-in policy")
			}
			if !allowed {
				return nil, huma.Error401Unauthorized("invalid credentials")
			}
		}

		if !h.auth.CheckPassword(input.Body.Password, user.PasswordHash) {
			return nil, huma.Error401Unauthorized("invalid credentials")
		}
		if h.emailVerificationRequired && user.EmailVerifiedAt.IsZero() {
			return h.beginEmailVerification(ctx, user, false)
		}

		methods, err := h.loginMFAMethods(ctx, user)
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

func (h *AuthHandler) VerifyRecoveryCodeLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "verify-login-recovery-code",
		Method:      http.MethodPost,
		Path:        "/auth/login/recovery-code",
		Summary:     "Complete MFA login with a single-use recovery code",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 401, 429},
	}, func(ctx context.Context, input *VerifyRecoveryCodeLoginInput) (*AuthOutput, error) {
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

		var challengePayload loginChallengePayload
		if err := json.Unmarshal([]byte(challenge.Payload), &challengePayload); err != nil ||
			!slices.Contains(challengePayload.Methods, mfaMethodRecoveryCode) {
			return nil, huma.Error400BadRequest("recovery-code login is not available for this challenge")
		}

		user, err := h.getUserByID(ctx, challenge.UserID)
		if err != nil || len(user.TOTPSecretEnc) == 0 {
			return nil, huma.Error401Unauthorized("invalid recovery code")
		}

		now := time.Now().UTC()
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			consumed, consumeErr := h.mfaRecovery.ConsumeWithDB(
				txCtx,
				tx,
				challenge.UserID,
				input.Body.Code,
				now,
			)
			if consumeErr != nil {
				return consumeErr
			}
			if !consumed {
				return sql.ErrNoRows
			}
			return consumeChallengeWithDB(txCtx, tx, challenge.ID, challenge.UserID, authChallengeLoginMFA)
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error401Unauthorized("invalid recovery code")
		}
		if err != nil {
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

func (h *AuthHandler) BeginPasskeyReauthentication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "begin-passkey-reauthentication",
		Method:      http.MethodPost,
		Path:        "/auth/reauth/passkey/options",
		Summary:     "Begin action-bound reauthentication with a passkey",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *BeginPasskeyReauthInput) (*PasskeyCeremonyOutput, error) {
		if h.identity == nil || middleware.GetSessionID(ctx) == "" {
			return nil, huma.Error401Unauthorized("a web session is required")
		}
		user, err := h.getUserByID(ctx, middleware.GetUserID(ctx))
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
			return nil, huma.Error500InternalServerError("failed to prepare passkey reauthentication")
		}
		options, session, err := h.mfa.BeginPasskeyLogin(webAuthnUser)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to begin passkey reauthentication")
		}
		sessionData, err := mfa.MarshalSessionData(session)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to persist passkey challenge")
		}
		challengeID, err := h.createChallenge(ctx, user.ID, authChallengePasskeyReauth, passkeyChallengePayload{
			SessionData: sessionData,
			SessionID:   middleware.GetSessionID(ctx),
			Action:      strings.TrimSpace(input.Body.Action),
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create passkey challenge")
		}
		out := &PasskeyCeremonyOutput{}
		out.Body.ChallengeID = challengeID
		out.Body.Options = options
		return out, nil
	})
}

func (h *AuthHandler) FinishPasskeyReauthentication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "finish-passkey-reauthentication",
		Method:      http.MethodPost,
		Path:        "/auth/reauth/passkey/verify",
		Summary:     "Complete action-bound reauthentication with a passkey",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, h.finishPasskeyReauthentication)
}

func (h *AuthHandler) finishPasskeyReauthentication(
	ctx context.Context,
	input *FinishPasskeyReauthInput,
) (*ReauthGrantOutput, error) {
	if h.identity == nil || middleware.GetSessionID(ctx) == "" {
		return nil, huma.Error401Unauthorized("a web session is required")
	}
	userID, sessionID, action, err := h.consumePasskeyReauthChallenge(ctx, input)
	if err != nil {
		return nil, err
	}
	grant, err := h.identity.CreateReauthGrant(ctx, userID, sessionID, action, "passkey", "")
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create reauthentication grant")
	}
	out := &ReauthGrantOutput{}
	out.Body.Grant = grant
	out.Body.ExpiresIn = int(identity.ReauthGrantTTL.Seconds())
	return out, nil
}

func (h *AuthHandler) consumePasskeyReauthChallenge(
	ctx context.Context,
	input *FinishPasskeyReauthInput,
) (string, string, string, error) {
	challenge, err := h.getChallenge(ctx, input.Body.ChallengeID, authChallengePasskeyReauth)
	if err != nil || challenge.UserID != middleware.GetUserID(ctx) {
		return "", "", "", huma.Error401Unauthorized("invalid or expired passkey challenge")
	}
	var payload passkeyChallengePayload
	if err := json.Unmarshal([]byte(challenge.Payload), &payload); err != nil ||
		payload.SessionID != middleware.GetSessionID(ctx) || strings.TrimSpace(payload.Action) == "" {
		return "", "", "", huma.Error401Unauthorized("invalid passkey challenge")
	}
	user, err := h.getUserByID(ctx, challenge.UserID)
	if err != nil {
		return "", "", "", huma.Error401Unauthorized("user not found")
	}
	sessionData, err := mfa.UnmarshalSessionData(payload.SessionData)
	if err != nil {
		return "", "", "", huma.Error500InternalServerError("failed to restore passkey challenge")
	}
	passkeys, err := h.listPasskeys(ctx, user.ID)
	if err != nil {
		return "", "", "", huma.Error500InternalServerError("failed to load passkeys")
	}
	webAuthnUser, err := mfa.NewWebAuthnUser(user, passkeys)
	if err != nil {
		return "", "", "", huma.Error500InternalServerError("failed to prepare passkey validation")
	}
	credential, err := h.mfa.FinishPasskeyLogin(webAuthnUser, *sessionData, input.Body.Credential)
	if err != nil {
		return "", "", "", huma.Error401Unauthorized("passkey verification failed")
	}
	if err := h.markPasskeyUsed(ctx, user.ID, credential.ID); err != nil {
		return "", "", "", huma.Error500InternalServerError("failed to update passkey state")
	}
	if err := h.deleteChallenge(ctx, challenge.ID); err != nil {
		return "", "", "", huma.Error500InternalServerError("failed to finish passkey reauthentication")
	}
	return user.ID, payload.SessionID, payload.Action, nil
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

		return &MeOutput{Body: h.profileForUser(ctx, user)}, nil
	})
}

func (h *AuthHandler) SessionState(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-auth-session-state",
		Method:      http.MethodGet,
		Path:        "/auth/session-state",
		Summary:     "Get optional web session state",
		Description: "Returns an anonymous state instead of an authorization error when no valid session is present.",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.OptionalAuthMiddleware(h.authenticator)},
	}, func(ctx context.Context, _ *struct{}) (*AuthSessionStateOutput, error) {
		out := &AuthSessionStateOutput{}
		userID := middleware.GetUserID(ctx)
		if userID == "" {
			return out, nil
		}

		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return out, nil
			}
			return nil, huma.Error500InternalServerError("failed to load session user")
		}

		out.Body.Authenticated = true
		out.Body.User = h.profileForUser(ctx, user)
		return out, nil
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
		if err := h.updateUserProfile(ctx, userID, input.Body); err != nil {
			return nil, err
		}

		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		return &MeOutput{Body: h.profileForUser(ctx, user)}, nil
	})
}

func (h *AuthHandler) updateUserProfile(ctx context.Context, userID string, body UpdateProfileInputBody) error {
	update := h.db.NewUpdate().Model((*models.User)(nil)).Where("id = ?", userID)
	hasChange := false
	for _, apply := range []func() (bool, error){
		func() (bool, error) { return h.applyUsernameUpdate(ctx, update, userID, body.Username) },
		func() (bool, error) { return applyDisplayNameUpdate(update, body.DisplayName) },
		func() (bool, error) { return applyAvatarURLUpdate(update, body.AvatarURL) },
		func() (bool, error) {
			return h.applyPublicProfileUpdate(
				ctx,
				update,
				userID,
				body.Username,
				body.PublicProfileEnabled,
				body.PublicProfileVisibleFields,
			)
		},
		func() (bool, error) {
			return applyPublicProfileVisibilityUpdate(update, body.PublicProfileVisibleFields)
		},
		func() (bool, error) { return applyComposerExperienceUpdate(update, body.ComposerExperience) },
	} {
		changed, err := apply()
		if err != nil {
			return err
		}
		hasChange = hasChange || changed
	}
	if !hasChange {
		return nil
	}
	if _, err := update.Exec(ctx); err != nil {
		if isUsernameUniqueConflict(err) {
			return huma.Error409Conflict("username already registered")
		}
		return huma.Error500InternalServerError("failed to update profile")
	}
	return nil
}

func registrationInsertError(err error) error {
	if err == nil {
		return nil
	}
	lower := strings.ToLower(err.Error())
	if (strings.Contains(lower, "unique") || strings.Contains(lower, "duplicate")) && strings.Contains(lower, "username") {
		return errUsernameAlreadyRegistered
	}
	if (strings.Contains(lower, "unique") || strings.Contains(lower, "duplicate")) && strings.Contains(lower, "email") {
		return errEmailAlreadyRegistered
	}
	return err
}

func isUsernameUniqueConflict(err error) bool {
	return errors.Is(registrationInsertError(err), errUsernameAlreadyRegistered)
}

func (h *AuthHandler) applyUsernameUpdate(
	ctx context.Context,
	update *bun.UpdateQuery,
	userID string,
	requested *string,
) (bool, error) {
	if requested == nil {
		return false, nil
	}
	username := usernames.Normalize(*requested)
	if err := usernames.Validate(username); err != nil {
		return false, huma.Error400BadRequest(err.Error())
	}
	exists, err := h.db.NewSelect().Model((*models.User)(nil)).
		Where("LOWER(username) = ? AND id <> ?", username, userID).
		Exists(ctx)
	if err != nil {
		return false, huma.Error500InternalServerError("failed to validate username")
	}
	if exists {
		return false, huma.Error409Conflict("username already registered")
	}
	update.Set("username = ?", username)
	return true, nil
}

func applyDisplayNameUpdate(update *bun.UpdateQuery, requested *string) (bool, error) {
	if requested == nil {
		return false, nil
	}
	displayName := strings.TrimSpace(*requested)
	if len(displayName) > 120 {
		return false, huma.Error400BadRequest("display name must be at most 120 characters")
	}
	update.Set("display_name = ?", displayName)
	return true, nil
}

func applyAvatarURLUpdate(update *bun.UpdateQuery, requested *string) (bool, error) {
	if requested == nil {
		return false, nil
	}
	avatarURL := strings.TrimSpace(*requested)
	if len(avatarURL) > 1000 {
		return false, huma.Error400BadRequest("avatar url must be at most 1000 characters")
	}
	update.Set("avatar_url = ?", avatarURL)
	return true, nil
}

func applyComposerExperienceUpdate(update *bun.UpdateQuery, requested *string) (bool, error) {
	if requested == nil {
		return false, nil
	}
	experience := strings.TrimSpace(*requested)
	if experience != "specialized" && experience != "unified" {
		return false, huma.Error400BadRequest("composer experience must be specialized or unified")
	}
	update.Set("composer_experience = ?", experience)
	return true, nil
}

func (h *AuthHandler) applyPublicProfileUpdate(
	ctx context.Context,
	update *bun.UpdateQuery,
	userID string,
	requestedUsername *string,
	enabled *bool,
	visibleFields *[]string,
) (bool, error) {
	if enabled == nil {
		return false, nil
	}
	if *enabled {
		if !h.publicProfilesEnabled {
			return false, huma.Error403Forbidden("public profiles are disabled for this instance")
		}
		username, err := h.profileUsername(ctx, userID, requestedUsername)
		if err != nil {
			return false, err
		}
		if username == "" {
			return false, huma.Error400BadRequest("set a username before making the profile public")
		}
		if visibleFields == nil {
			var currentlyPublic bool
			if err := h.db.NewSelect().
				Model((*models.User)(nil)).
				Column("public_profile_enabled").
				Where("id = ?", userID).
				Scan(ctx, &currentlyPublic); err != nil {
				return false, huma.Error500InternalServerError("failed to load public profile settings")
			}
			if !currentlyPublic {
				return false, huma.Error400BadRequest("choose which profile fields to show before making the profile public")
			}
		}
	}
	update.Set("public_profile_enabled = ?", *enabled)
	return true, nil
}

func applyPublicProfileVisibilityUpdate(update *bun.UpdateQuery, requested *[]string) (bool, error) {
	if requested == nil {
		return false, nil
	}
	raw, _, err := publicprofiles.Normalize(*requested)
	if errors.Is(err, publicprofiles.ErrUnsupportedField) {
		return false, huma.Error400BadRequest("unsupported public profile field")
	}
	if err != nil {
		return false, huma.Error500InternalServerError("failed to update public profile visibility")
	}
	update.Set("public_profile_visibility_json = ?", raw)
	return true, nil
}

func (h *AuthHandler) profileUsername(ctx context.Context, userID string, requested *string) (string, error) {
	if requested != nil {
		return usernames.Normalize(*requested), nil
	}
	username := ""
	if err := h.db.NewSelect().Model((*models.User)(nil)).Column("username").Where("id = ?", userID).Scan(ctx, &username); err != nil {
		return "", huma.Error500InternalServerError("failed to load username")
	}
	return username, nil
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
		resp.Body.User = h.profileForUser(ctx, user)
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
		Errors:      []int{400, 401, 409, 429},
	}, func(ctx context.Context, input *SetupTOTPInput) (*SetupTOTPOutput, error) {
		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if len(user.TOTPSecretEnc) > 0 {
			return nil, huma.Error409Conflict("authenticator app is already enabled")
		}
		if err := h.authorizeSensitiveAction(
			ctx,
			user,
			reauthActionTOTPSetup,
			input.Body.CurrentPassword,
			input.Body.ReauthGrant,
		); err != nil {
			return nil, err
		}

		key, qrPNG, err := h.mfa.GenerateTOTP(user.Email)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to generate authenticator secret")
		}

		secretEnc, err := h.encryptor.Encrypt(key.Secret())
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to protect authenticator secret")
		}

		challengeID, err := h.createExclusiveChallenge(ctx, user.ID, authChallengeTOTPSetup, totpSetupPayload{
			SecretEncrypted: base64.StdEncoding.EncodeToString(secretEnc),
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create setup challenge")
		}

		resp := &SetupTOTPOutput{}
		resp.CacheControl = "no-store"
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
		Errors:      []int{400, 401, 409},
	}, func(ctx context.Context, input *ConfirmTOTPSetupInput) (*RecoveryCodeSetOutput, error) {
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
		if len(payload.RecoveryCodeHashes) > 0 {
			return nil, huma.Error409Conflict("recovery codes were already issued; restart setup if they were lost")
		}

		secret, err := h.resolveTOTPSetupSecret(payload)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to read setup challenge")
		}
		if !h.mfa.ValidateTOTP(secret, input.Body.Code) {
			return nil, huma.Error400BadRequest("invalid authenticator code")
		}

		set, err := h.mfaRecovery.Generate()
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to generate recovery codes")
		}
		payload.RecoveryBatchID = set.BatchID
		payload.RecoveryCodeHashes = set.Hashes
		updatedPayload, err := json.Marshal(payload)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to protect recovery codes")
		}
		result, err := h.db.NewUpdate().Model((*models.AuthChallenge)(nil)).
			Set("payload = ?", string(updatedPayload)).
			Where(
				"id = ? AND user_id = ? AND type = ? AND payload = ? AND expires_at > ?",
				challenge.ID,
				challenge.UserID,
				authChallengeTOTPSetup,
				challenge.Payload,
				time.Now().UTC(),
			).
			Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to protect recovery codes")
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to protect recovery codes")
		}
		if affected != 1 {
			return nil, huma.Error409Conflict("setup expired or recovery codes were already issued; restart setup")
		}

		response := &RecoveryCodeSetOutput{}
		response.CacheControl = "no-store"
		response.Body.ChallengeID = challenge.ID
		response.Body.RecoveryCodes = set.Codes
		return response, nil
	})
}

func (h *AuthHandler) AcknowledgeTOTPSetup(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "enable-totp-after-recovery-code-acknowledgement",
		Method:      http.MethodPost,
		Path:        "/auth/security/totp/enable",
		Summary:     "Enable TOTP after recovery codes are saved",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401, 409},
	}, func(ctx context.Context, input *AcknowledgeRecoveryCodesInput) (*SecurityStatusOutput, error) {
		if !input.Body.RecoveryCodesSaved {
			return nil, huma.Error400BadRequest("confirm that the recovery codes were saved before enabling the authenticator app")
		}
		challenge, payload, err := h.loadVerifiedTOTPSetupChallenge(ctx, input.Body.ChallengeID)
		if err != nil {
			return nil, err
		}
		secret, err := h.resolveTOTPSetupSecret(payload)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to read setup challenge")
		}
		secretEnc, err := h.encryptor.Encrypt(secret)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to save authenticator secret")
		}
		set := mfarecovery.GeneratedSet{BatchID: payload.RecoveryBatchID, Hashes: payload.RecoveryCodeHashes}
		now := time.Now().UTC()
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if consumeErr := consumeChallengeWithDB(
				txCtx,
				tx,
				challenge.ID,
				challenge.UserID,
				authChallengeTOTPSetup,
			); consumeErr != nil {
				return consumeErr
			}
			result, updateErr := tx.NewUpdate().Model((*models.User)(nil)).
				Set("totp_secret_encrypted = ?", secretEnc).
				Set("totp_enabled_at = ?", now).
				Where("id = ? AND totp_secret_encrypted IS NULL", challenge.UserID).
				Exec(txCtx)
			if updateErr != nil {
				return updateErr
			}
			affected, updateErr := result.RowsAffected()
			if updateErr != nil || affected != 1 {
				return sql.ErrNoRows
			}
			return h.mfaRecovery.ReplaceWithDB(txCtx, tx, challenge.UserID, set, now)
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error409Conflict("authenticator setup was already completed or replaced")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to enable authenticator app")
		}
		return h.securityStatusResponse(ctx, challenge.UserID)
	})
}

func (h *AuthHandler) RecoveryCodeStatus(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-totp-recovery-code-status",
		Method:      http.MethodPost,
		Path:        "/auth/security/totp/recovery-codes/status",
		Summary:     "Get the unused TOTP recovery-code count after reauthentication",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401, 409, 429},
	}, func(ctx context.Context, input *RecoveryCodeSensitiveActionInput) (*RecoveryCodeStatusOutput, error) {
		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if len(user.TOTPSecretEnc) == 0 {
			return nil, huma.Error409Conflict("authenticator app is not enabled")
		}
		if err := h.authorizeSensitiveAction(
			ctx,
			user,
			reauthActionRecoveryStatus,
			input.Body.CurrentPassword,
			input.Body.ReauthGrant,
		); err != nil {
			return nil, err
		}
		remaining, err := h.mfaRecovery.CountRemaining(ctx, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load recovery-code status")
		}
		response := &RecoveryCodeStatusOutput{}
		response.Body.Remaining = remaining
		return response, nil
	})
}

func (h *AuthHandler) BeginRecoveryCodeRegeneration(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "begin-totp-recovery-code-regeneration",
		Method:      http.MethodPost,
		Path:        "/auth/security/totp/recovery-codes/regenerate",
		Summary:     "Generate a replacement recovery-code set after reauthentication",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401, 409, 429},
	}, func(ctx context.Context, input *RecoveryCodeSensitiveActionInput) (*RecoveryCodeSetOutput, error) {
		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if len(user.TOTPSecretEnc) == 0 {
			return nil, huma.Error409Conflict("authenticator app is not enabled")
		}
		if err := h.authorizeSensitiveAction(
			ctx,
			user,
			reauthActionRecoveryReset,
			input.Body.CurrentPassword,
			input.Body.ReauthGrant,
		); err != nil {
			return nil, err
		}
		set, err := h.mfaRecovery.Generate()
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to generate recovery codes")
		}
		challengeID, err := h.createExclusiveChallenge(ctx, userID, authChallengeTOTPRecovery, recoveryCodeChallengePayload{
			BatchID: set.BatchID,
			Hashes:  set.Hashes,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to protect recovery codes")
		}
		response := &RecoveryCodeSetOutput{}
		response.CacheControl = "no-store"
		response.Body.ChallengeID = challengeID
		response.Body.RecoveryCodes = set.Codes
		return response, nil
	})
}

func (h *AuthHandler) AcknowledgeRecoveryCodeRegeneration(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "activate-regenerated-totp-recovery-codes",
		Method:      http.MethodPost,
		Path:        "/auth/security/totp/recovery-codes/activate",
		Summary:     "Replace old recovery codes after the new set is saved",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401, 409},
	}, func(ctx context.Context, input *AcknowledgeRecoveryCodesInput) (*SecurityStatusOutput, error) {
		if !input.Body.RecoveryCodesSaved {
			return nil, huma.Error400BadRequest("confirm that the new recovery codes were saved before replacing the old set")
		}
		challenge, err := h.getChallenge(ctx, input.Body.ChallengeID, authChallengeTOTPRecovery)
		if err != nil || challenge.UserID != middleware.GetUserID(ctx) {
			return nil, huma.Error401Unauthorized("invalid or expired recovery-code challenge")
		}
		var payload recoveryCodeChallengePayload
		if err := json.Unmarshal([]byte(challenge.Payload), &payload); err != nil {
			return nil, huma.Error500InternalServerError("failed to read recovery-code challenge")
		}
		set := mfarecovery.GeneratedSet{BatchID: payload.BatchID, Hashes: payload.Hashes}
		now := time.Now().UTC()
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if consumeErr := consumeChallengeWithDB(
				txCtx,
				tx,
				challenge.ID,
				challenge.UserID,
				authChallengeTOTPRecovery,
			); consumeErr != nil {
				return consumeErr
			}
			enabled, selectErr := tx.NewSelect().Model((*models.User)(nil)).
				Where("id = ? AND totp_secret_encrypted IS NOT NULL", challenge.UserID).
				Exists(txCtx)
			if selectErr != nil {
				return selectErr
			}
			if !enabled {
				return sql.ErrNoRows
			}
			return h.mfaRecovery.ReplaceWithDB(txCtx, tx, challenge.UserID, set, now)
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error409Conflict("authenticator recovery-code setup was replaced or disabled")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to replace recovery codes")
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
		Errors:      []int{400, 401, 429},
	}, func(ctx context.Context, input *DisableTOTPInput) (*SecurityStatusOutput, error) {
		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if err := h.authorizeSensitiveAction(
			ctx,
			user,
			reauthActionTOTPDisable,
			input.Body.CurrentPassword,
			input.Body.ReauthGrant,
		); err != nil {
			return nil, err
		}

		if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, updateErr := tx.NewUpdate().Model((*models.User)(nil)).
				Set("totp_secret_encrypted = NULL").
				Set("totp_enabled_at = NULL").
				Where("id = ?", userID).
				Exec(txCtx); updateErr != nil {
				return updateErr
			}
			if revokeErr := h.mfaRecovery.RevokeAllWithDB(txCtx, tx, userID); revokeErr != nil {
				return revokeErr
			}
			_, deleteErr := tx.NewDelete().Model((*models.AuthChallenge)(nil)).
				Where("user_id = ? AND type IN (?, ?)", userID, authChallengeTOTPSetup, authChallengeTOTPRecovery).
				Exec(txCtx)
			return deleteErr
		}); err != nil {
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
		Errors:      []int{400, 401, 429},
	}, func(ctx context.Context, input *BeginPasskeyRegistrationInput) (*PasskeyCeremonyOutput, error) {
		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if err := h.authorizeSensitiveAction(
			ctx,
			user,
			reauthActionPasskeyAdd,
			input.Body.CurrentPassword,
			input.Body.ReauthGrant,
		); err != nil {
			return nil, err
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
		Errors:      []int{400, 401, 404, 429, 500},
	}, func(ctx context.Context, input *RemovePasskeyInput) (*SecurityStatusOutput, error) {
		userID := middleware.GetUserID(ctx)
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error404NotFound("user not found")
		}
		if err := h.authorizeSensitiveAction(
			ctx,
			user,
			reauthActionPasskeyRemove,
			input.Body.CurrentPassword,
			input.Body.ReauthGrant,
		); err != nil {
			return nil, err
		}

		if h.identity == nil {
			return nil, huma.Error500InternalServerError("identity service is unavailable")
		}
		if err := h.identity.RemovePasskey(ctx, userID, input.PasskeyID); err != nil {
			switch {
			case errors.Is(err, identity.ErrFinalCredential):
				return nil, huma.Error400BadRequest("add another sign-in method before removing this passkey")
			case errors.Is(err, identity.ErrPasskeyNotFound):
				return nil, huma.Error404NotFound("passkey not found")
			default:
				return nil, huma.Error500InternalServerError("failed to remove passkey")
			}
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
	resp.Body.User = h.profileForUser(ctx, user)
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

func (h *AuthHandler) loginMFAMethods(ctx context.Context, user *models.User) ([]string, error) {
	methods, err := h.enabledMFAMethods(ctx, user)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(methods, mfaMethodTOTP) {
		return methods, nil
	}
	remaining, err := h.mfaRecovery.CountRemaining(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if remaining > 0 {
		methods = append(methods, mfaMethodRecoveryCode)
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

func (h *AuthHandler) createExclusiveChallenge(
	ctx context.Context,
	userID,
	challengeType string,
	payload interface{},
) (string, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	record := &models.AuthChallenge{
		ID:        uuid.NewString(),
		UserID:    userID,
		Type:      challengeType,
		Payload:   string(payloadBytes),
		ExpiresAt: mfa.ChallengeExpiry(),
		CreatedAt: time.Now().UTC(),
	}
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, deleteErr := tx.NewDelete().Model((*models.AuthChallenge)(nil)).
			Where("user_id = ? AND type = ?", userID, challengeType).
			Exec(txCtx); deleteErr != nil {
			return deleteErr
		}
		_, insertErr := tx.NewInsert().Model(record).Exec(txCtx)
		return insertErr
	})
	if err != nil {
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

func consumeChallengeWithDB(
	ctx context.Context,
	db bun.IDB,
	challengeID,
	userID,
	challengeType string,
) error {
	result, err := db.NewDelete().Model((*models.AuthChallenge)(nil)).
		Where(
			"id = ? AND user_id = ? AND type = ? AND expires_at > ?",
			challengeID,
			userID,
			challengeType,
			time.Now().UTC(),
		).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return sql.ErrNoRows
	}
	return nil
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

func (h *AuthHandler) loadVerifiedTOTPSetupChallenge(
	ctx context.Context,
	challengeID string,
) (*models.AuthChallenge, totpSetupPayload, error) {
	challenge, err := h.getChallenge(ctx, challengeID, authChallengeTOTPSetup)
	if err != nil || challenge.UserID != middleware.GetUserID(ctx) {
		return nil, totpSetupPayload{}, huma.Error401Unauthorized("invalid or expired setup challenge")
	}
	var payload totpSetupPayload
	if err := json.Unmarshal([]byte(challenge.Payload), &payload); err != nil {
		return nil, totpSetupPayload{}, huma.Error500InternalServerError("failed to read setup challenge")
	}
	if payload.RecoveryBatchID == "" || len(payload.RecoveryCodeHashes) != mfarecovery.CodeCount {
		return nil, totpSetupPayload{}, huma.Error409Conflict("verify the authenticator code before enabling the authenticator app")
	}
	return challenge, payload, nil
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
	resp.Body.User = h.profileForUser(ctx, user)
	resp.Body.TOTPEnabled = len(user.TOTPSecretEnc) > 0
	resp.Body.Passkeys = toPasskeySummaries(passkeys)
	resp.Body.Methods = methods
	return resp, nil
}

func (h *AuthHandler) toUserProfile(user *models.User) *UserProfile {
	hasPassword := strings.TrimSpace(user.PasswordHash) != ""
	return &UserProfile{
		ID:                         user.ID,
		Email:                      user.Email,
		Username:                   user.Username,
		DisplayName:                user.DisplayName,
		AvatarURL:                  user.AvatarURL,
		PublicProfileEnabled:       user.PublicProfile,
		PublicProfileVisibleFields: publicprofiles.Parse(user.PublicProfileVisibilityJSON).Fields(),
		ComposerExperience:         normalizedComposerExperience(user.ComposerExperience),
		IsAdmin:                    user.IsAdmin,
		HasPassword:                hasPassword,
		PasswordUsable:             hasPassword,
		TermsVersion:               user.TermsVersion,
		PrivacyVersion:             user.PrivacyVersion,
		LegalAcceptedAt:            user.LegalAcceptedAt,
		EmailVerified:              !user.EmailVerifiedAt.IsZero(),
		LegalAcceptanceRequired: h.accountPolicy.Required &&
			(user.LegalAcceptedAt.IsZero() ||
				user.TermsVersion != h.accountPolicy.TermsVersion ||
				user.PrivacyVersion != h.accountPolicy.PrivacyVersion),
		CreatedAt: user.CreatedAt,
	}
}

func normalizedComposerExperience(value string) string {
	if strings.TrimSpace(value) == "unified" {
		return "unified"
	}
	return "specialized"
}

func (h *AuthHandler) profileForUser(ctx context.Context, user *models.User) *UserProfile {
	profile := h.toUserProfile(user)
	if h.identity == nil {
		return profile
	}
	passwordAllowed, err := h.identity.PasswordCredentialAllowed(ctx, user.ID)
	if err != nil {
		profile.PasswordUsable = false
	} else {
		profile.PasswordUsable = profile.HasPassword && passwordAllowed
	}
	managed, organizationName, err := h.identity.ManagedUserState(ctx, user.ID)
	if err == nil {
		profile.IsManaged = managed
		profile.ManagedOrganizationName = organizationName
	}
	return profile
}

func (h *AuthHandler) authorizeSensitiveAction(
	ctx context.Context,
	user *models.User,
	action,
	currentPassword,
	grant string,
) error {
	if strings.TrimSpace(grant) == "" && currentPassword != "" &&
		!h.allowAuthAttempt(user.ID, "reauth:user", 20, 15*time.Minute) {
		return huma.Error429TooManyRequests("too many reauthentication attempts")
	}
	if h.identity != nil && strings.TrimSpace(grant) != "" {
		if err := h.identity.ConsumeReauthGrant(
			ctx,
			grant,
			user.ID,
			middleware.GetSessionID(ctx),
			action,
		); err != nil {
			return huma.Error401Unauthorized("recent reauthentication is required")
		}
		return nil
	}
	passwordAllowed := true
	if h.identity != nil {
		allowed, err := h.identity.PasswordCredentialAllowed(ctx, user.ID)
		if err != nil {
			return huma.Error500InternalServerError("failed to evaluate reauthentication policy")
		}
		passwordAllowed = allowed
	}
	if passwordAllowed && h.auth != nil &&
		h.auth.CheckPassword(currentPassword, user.PasswordHash) {
		return nil
	}
	if currentPassword == "" && strings.TrimSpace(grant) == "" {
		return huma.Error400BadRequest("a current password or one-time reauthentication grant is required")
	}
	return huma.Error401Unauthorized("recent reauthentication is required")
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
