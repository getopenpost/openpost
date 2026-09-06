package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/uptrace/bun"
)

const passwordResetTTL = time.Hour

type AccountPolicy struct {
	Required       bool
	TermsURL       string
	PrivacyURL     string
	TermsVersion   string
	PrivacyVersion string
	SupportEmail   string
}

func (p AccountPolicy) normalized() AccountPolicy {
	p.TermsURL = strings.TrimSpace(p.TermsURL)
	p.PrivacyURL = strings.TrimSpace(p.PrivacyURL)
	p.TermsVersion = strings.TrimSpace(p.TermsVersion)
	p.PrivacyVersion = strings.TrimSpace(p.PrivacyVersion)
	p.SupportEmail = strings.TrimSpace(p.SupportEmail)
	return p
}

type AuthConfigurationOutput struct {
	Body struct {
		RegistrationEnabled       bool   `json:"registration_enabled"`
		PasswordResetEnabled      bool   `json:"password_reset_enabled"`
		EmailVerificationRequired bool   `json:"email_verification_required"`
		PublicProfilesEnabled     bool   `json:"public_profiles_enabled"`
		LegalAcceptanceRequired   bool   `json:"legal_acceptance_required"`
		PurchaseChoiceRequired    bool   `json:"purchase_choice_required"`
		TermsURL                  string `json:"terms_url,omitempty"`
		PrivacyURL                string `json:"privacy_url,omitempty"`
		TermsVersion              string `json:"terms_version,omitempty"`
		PrivacyVersion            string `json:"privacy_version,omitempty"`
		SupportEmail              string `json:"support_email,omitempty"`
	}
}

type RequestPasswordResetInput struct {
	Body struct {
		Email string `json:"email" format:"email" doc:"Account email address"`
	}
}

type MessageOutput struct {
	Body struct {
		Message string `json:"message"`
	}
}

type ResetPasswordInput struct {
	Body struct {
		Token       string `json:"token" minLength:"32" doc:"Single-use password reset token"`
		NewPassword string `json:"new_password" minLength:"12" maxLength:"1024" doc:"New password"`
	}
}

type ResetPasswordOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		Message string `json:"message"`
	}
}

type ChangePasswordInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" doc:"Current password"`
		ReauthGrant     string `json:"reauth_grant,omitempty" doc:"One-time action-bound reauthentication grant"`
		NewPassword     string `json:"new_password" minLength:"12" maxLength:"1024" doc:"New password"`
	}
}

type ChangePasswordOutput struct {
	Body struct {
		Message         string `json:"message"`
		RevokedSessions int64  `json:"revoked_sessions"`
	}
}

type AcceptAccountPolicyInput struct {
	Body struct {
		AcceptedLegal bool `json:"accepted_legal" doc:"Whether the user accepts the current Terms and acknowledges the Privacy Policy"`
	}
}

func (h *AuthHandler) Configuration(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-auth-configuration",
		Method:      http.MethodGet,
		Path:        "/auth/config",
		Summary:     "Get public authentication configuration",
		Tags:        []string{tagAuth},
	}, func(_ context.Context, _ *struct{}) (*AuthConfigurationOutput, error) {
		out := &AuthConfigurationOutput{}
		out.Body.RegistrationEnabled = !h.registrationsDisabled
		out.Body.PasswordResetEnabled = h.passwordResetSender != nil
		out.Body.EmailVerificationRequired = h.emailVerificationRequired
		out.Body.PublicProfilesEnabled = h.publicProfilesEnabled
		out.Body.LegalAcceptanceRequired = h.accountPolicy.Required
		out.Body.PurchaseChoiceRequired = h.purchaseChoiceRequired
		out.Body.TermsURL = h.accountPolicy.TermsURL
		out.Body.PrivacyURL = h.accountPolicy.PrivacyURL
		out.Body.TermsVersion = h.accountPolicy.TermsVersion
		out.Body.PrivacyVersion = h.accountPolicy.PrivacyVersion
		out.Body.SupportEmail = h.accountPolicy.SupportEmail
		return out, nil
	})
}

func (h *AuthHandler) AcceptAccountPolicy(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "accept-account-policy",
		Method:      http.MethodPost,
		Path:        "/auth/legal-acceptance",
		Summary:     "Accept the current account policy",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *AcceptAccountPolicyInput) (*MeOutput, error) {
		if !h.accountPolicy.Required {
			return nil, huma.Error400BadRequest("account policy acceptance is not required for this instance")
		}
		if !input.Body.AcceptedLegal {
			return nil, huma.Error400BadRequest("accept the Terms of Service and acknowledge the Privacy Policy to continue")
		}
		now := time.Now().UTC()
		userID := middleware.GetUserID(ctx)
		if _, err := h.db.NewUpdate().Model((*models.User)(nil)).
			Set("terms_version = ?", h.accountPolicy.TermsVersion).
			Set("privacy_version = ?", h.accountPolicy.PrivacyVersion).
			Set("legal_accepted_at = ?", now).
			Where("id = ?", userID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to save account policy acceptance")
		}
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load account")
		}
		return &MeOutput{Body: h.profileForUser(ctx, user)}, nil
	})
}

func (h *AuthHandler) RequestPasswordReset(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "request-password-reset",
		Method:      http.MethodPost,
		Path:        "/auth/password-reset/request",
		Summary:     "Request a password reset link",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{429, 503},
	}, func(ctx context.Context, input *RequestPasswordResetInput) (*MessageOutput, error) {
		if h.passwordResetSender == nil || h.publicURL == "" {
			return nil, huma.Error503ServiceUnavailable("password reset is not configured for this instance")
		}
		email := strings.TrimSpace(strings.ToLower(input.Body.Email))
		if !h.allowAuthAttempt(clientIP(ctx), "password-reset:ip", 10, time.Hour) ||
			!h.allowAuthAttempt(email, "password-reset:email", 3, time.Hour) {
			return nil, huma.Error429TooManyRequests("too many password reset requests")
		}

		out := &MessageOutput{}
		out.Body.Message = "If an account exists for that email, a password reset link has been sent."
		var user models.User
		if err := h.db.NewSelect().Model(&user).Where("email = ?", email).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return out, nil
			}
			return nil, huma.Error500InternalServerError("failed to request password reset")
		}
		if h.identity != nil {
			allowed, policyErr := h.identity.PasswordCredentialAllowed(ctx, user.ID)
			if policyErr != nil {
				return nil, huma.Error500InternalServerError("failed to request password reset")
			}
			if !allowed {
				return out, nil
			}
		}

		rawToken, tokenHash, err := generatePasswordResetToken()
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to request password reset")
		}
		now := time.Now().UTC()
		reset := &models.PasswordResetToken{
			ID:        uuid.NewString(),
			UserID:    user.ID,
			TokenHash: tokenHash,
			ExpiresAt: now.Add(passwordResetTTL),
			CreatedAt: now,
		}
		if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, err := tx.NewDelete().Model((*models.PasswordResetToken)(nil)).
				Where("user_id = ? AND used_at IS NULL", user.ID).Exec(txCtx); err != nil {
				return err
			}
			_, err := tx.NewInsert().Model(reset).Exec(txCtx)
			return err
		}); err != nil {
			return nil, huma.Error500InternalServerError("failed to request password reset")
		}

		resetURL := h.publicURL + "/reset-password#token=" + url.QueryEscape(rawToken)
		if err := h.passwordResetSender.SendPasswordReset(ctx, passwordmail.ResetMessage{
			Recipient:      user.Email,
			ResetURL:       resetURL,
			ExpiresAt:      reset.ExpiresAt,
			IdempotencyKey: "password-reset-" + reset.ID,
		}); err != nil {
			_, _ = h.db.NewDelete().Model((*models.PasswordResetToken)(nil)).Where("id = ?", reset.ID).Exec(ctx)
			log.Printf("password reset delivery failed for user %s: %v", user.ID, err)
			// Preserve the same response for known and unknown addresses. Delivery
			// failures are operationally visible without creating an enumeration oracle.
			return out, nil
		}
		return out, nil
	})
}

func (h *AuthHandler) ResetPassword(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "reset-password",
		Method:      http.MethodPost,
		Path:        "/auth/password-reset/confirm",
		Summary:     "Reset a password with a single-use token",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 429},
	}, func(ctx context.Context, input *ResetPasswordInput) (*ResetPasswordOutput, error) {
		if !h.allowAuthAttempt(clientIP(ctx), "password-reset-confirm:ip", 10, time.Hour) {
			return nil, huma.Error429TooManyRequests("too many password reset attempts")
		}
		if err := validateNewPassword(input.Body.NewPassword); err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		newHash, err := h.auth.HashPassword(input.Body.NewPassword)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to reset password")
		}
		tokenHash := hashPasswordResetToken(input.Body.Token)
		now := time.Now().UTC()
		if err := h.validatePasswordResetPolicy(ctx, tokenHash, now); err != nil {
			return nil, err
		}
		if err := h.applyPasswordReset(ctx, tokenHash, newHash, now); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error400BadRequest("password reset link is invalid or expired")
			}
			return nil, huma.Error500InternalServerError("failed to reset password")
		}

		out := &ResetPasswordOutput{}
		out.SetCookie = expiredSessionCookie(middleware.IsSecureRequest(ctx)).String()
		out.Body.Message = "Password reset. Sign in with your new password."
		return out, nil
	})
}

func (h *AuthHandler) validatePasswordResetPolicy(ctx context.Context, tokenHash string, now time.Time) error {
	if h.identity == nil {
		return nil
	}
	var pending models.PasswordResetToken
	if err := h.db.NewSelect().Model(&pending).
		Where("token_hash = ? AND used_at IS NULL AND expires_at > ?", tokenHash, now).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return huma.Error400BadRequest("password reset link is invalid or expired")
		}
		return huma.Error500InternalServerError("failed to reset password")
	}
	allowed, err := h.identity.PasswordCredentialAllowed(ctx, pending.UserID)
	if err != nil {
		return huma.Error500InternalServerError("failed to reset password")
	}
	if !allowed {
		return huma.Error400BadRequest("password reset is disabled by organization policy")
	}
	return nil
}

func (h *AuthHandler) applyPasswordReset(
	ctx context.Context,
	tokenHash,
	newHash string,
	now time.Time,
) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var reset models.PasswordResetToken
		if err := tx.NewSelect().Model(&reset).
			Where("token_hash = ? AND used_at IS NULL AND expires_at > ?", tokenHash, now).
			Scan(txCtx); err != nil {
			return err
		}
		result, err := tx.NewUpdate().Model((*models.PasswordResetToken)(nil)).
			Set("used_at = ?", now).
			Where("id = ? AND used_at IS NULL", reset.ID).Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil || rows != 1 {
			return sql.ErrNoRows
		}
		if _, err := tx.NewUpdate().Model((*models.User)(nil)).
			Set("password_hash = ?", newHash).Where("id = ?", reset.UserID).Exec(txCtx); err != nil {
			return err
		}
		_, err = tx.NewUpdate().Model((*models.UserSession)(nil)).
			Set("revoked_at = ?", now).
			Where("user_id = ? AND revoked_at IS NULL", reset.UserID).Exec(txCtx)
		return err
	})
}

func (h *AuthHandler) ChangePassword(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "change-password",
		Method:      http.MethodPost,
		Path:        "/auth/password",
		Summary:     "Change the current account password",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 401, 429},
	}, func(ctx context.Context, input *ChangePasswordInput) (*ChangePasswordOutput, error) {
		userID := middleware.GetUserID(ctx)
		if !h.allowAuthAttempt(userID, "password-change:user", 5, time.Hour) {
			return nil, huma.Error429TooManyRequests("too many password change attempts")
		}
		if err := validateNewPassword(input.Body.NewPassword); err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		user, err := h.getUserByID(ctx, userID)
		if err != nil {
			return nil, huma.Error401Unauthorized("account not found")
		}
		if h.identity != nil {
			allowed, policyErr := h.identity.PasswordCredentialAllowed(ctx, user.ID)
			if policyErr != nil {
				return nil, huma.Error500InternalServerError("failed to evaluate password policy")
			}
			if !allowed {
				return nil, huma.Error403Forbidden("local passwords are disabled by organization policy")
			}
		}
		if err := h.authorizeSensitiveAction(
			ctx,
			user,
			reauthActionPassword,
			input.Body.CurrentPassword,
			input.Body.ReauthGrant,
		); err != nil {
			return nil, err
		}
		if user.PasswordHash != "" && h.auth.CheckPassword(input.Body.NewPassword, user.PasswordHash) {
			return nil, huma.Error400BadRequest("new password must be different from the current password")
		}
		newHash, err := h.auth.HashPassword(input.Body.NewPassword)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to change password")
		}
		now := time.Now().UTC()
		var revoked int64
		if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, err := tx.NewUpdate().Model((*models.User)(nil)).Set("password_hash = ?", newHash).
				Where("id = ?", userID).Exec(txCtx); err != nil {
				return err
			}
			query := tx.NewUpdate().Model((*models.UserSession)(nil)).Set("revoked_at = ?", now).
				Where("user_id = ? AND revoked_at IS NULL", userID)
			if currentSessionID := middleware.GetSessionID(ctx); currentSessionID != "" {
				query = query.Where("id != ?", currentSessionID)
			}
			result, err := query.Exec(txCtx)
			if err != nil {
				return err
			}
			revoked, err = result.RowsAffected()
			return err
		}); err != nil {
			return nil, huma.Error500InternalServerError("failed to change password")
		}
		out := &ChangePasswordOutput{}
		out.Body.Message = "Password changed. Other browser sessions were signed out."
		out.Body.RevokedSessions = revoked
		return out, nil
	})
}

func validateNewPassword(password string) error {
	characters := utf8.RuneCountInString(password)
	if characters < 12 {
		return fmt.Errorf("password must be at least 12 characters")
	}
	if characters > 1024 {
		return fmt.Errorf("password is too long")
	}
	return nil
}

func generatePasswordResetToken() (string, string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	raw := base64.RawURLEncoding.EncodeToString(bytes)
	return raw, hashPasswordResetToken(raw), nil
}

func hashPasswordResetToken(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(sum[:])
}
