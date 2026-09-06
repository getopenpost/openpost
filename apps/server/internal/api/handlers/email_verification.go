package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/emailverification"
	"github.com/openpost/backend/internal/services/passwordmail"
)

type ConfirmEmailVerificationInput struct {
	Body struct {
		ChallengeID string `json:"challenge_id" minLength:"16" doc:"Opaque email verification challenge ID"`
		Code        string `json:"code" minLength:"6" maxLength:"6" pattern:"^[0-9]{6}$" doc:"Six-digit verification code"`
	}
}

type ResendEmailVerificationInput struct {
	Body struct {
		ChallengeID string `json:"challenge_id" minLength:"16" doc:"Opaque email verification challenge ID"`
	}
}

func (h *AuthHandler) ConfirmEmailVerification(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "confirm-email-verification",
		Method:      http.MethodPost,
		Path:        "/auth/email-verification/confirm",
		Summary:     "Verify a new account email with a six-digit code",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 403, 429, 503},
	}, func(ctx context.Context, input *ConfirmEmailVerificationInput) (*AuthOutput, error) {
		if h.emailVerification == nil || !h.emailVerificationRequired {
			return nil, huma.Error503ServiceUnavailable("email verification is not enabled for this instance")
		}
		if !h.allowAuthAttempt(clientIP(ctx), "email-verification:ip", 30, 15*time.Minute) ||
			!h.allowAuthAttempt(strings.TrimSpace(input.Body.ChallengeID), "email-verification:challenge", 10, 15*time.Minute) {
			return nil, huma.Error429TooManyRequests("too many email verification attempts")
		}
		user, err := h.emailVerification.Verify(ctx, input.Body.ChallengeID, input.Body.Code)
		switch {
		case err == nil:
			return h.issueAuthResponse(ctx, user)
		case errors.Is(err, emailverification.ErrInvalidCode):
			return nil, huma.Error400BadRequest("verification code is incorrect")
		case errors.Is(err, emailverification.ErrTooManyAttempts):
			return nil, huma.Error429TooManyRequests("too many incorrect codes; request a new code")
		case errors.Is(err, emailverification.ErrChallengeExpired),
			errors.Is(err, emailverification.ErrChallengeNotFound),
			errors.Is(err, emailverification.ErrAlreadyVerified):
			return nil, huma.Error400BadRequest("verification code is invalid or expired")
		case errors.Is(err, emailverification.ErrRegistrationsClosed):
			return nil, huma.Error403Forbidden("registrations are disabled for this instance")
		default:
			return nil, huma.Error500InternalServerError("failed to verify email address")
		}
	})
}

func (h *AuthHandler) ResendEmailVerification(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "resend-email-verification",
		Method:      http.MethodPost,
		Path:        "/auth/email-verification/resend",
		Summary:     "Send a replacement email verification code",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 429, 503},
	}, func(ctx context.Context, input *ResendEmailVerificationInput) (*AuthOutput, error) {
		if h.emailVerification == nil || h.emailSender == nil || !h.emailVerificationRequired {
			return nil, huma.Error503ServiceUnavailable("email verification is not configured for this instance")
		}
		if !h.allowAuthAttempt(clientIP(ctx), "email-verification-resend:ip", 10, time.Hour) ||
			!h.allowAuthAttempt(strings.TrimSpace(input.Body.ChallengeID), "email-verification-resend:challenge", 5, time.Hour) {
			return nil, huma.Error429TooManyRequests("too many verification email requests")
		}
		pending, err := h.emailVerification.Resend(ctx, input.Body.ChallengeID)
		if errors.Is(err, emailverification.ErrResendTooSoon) {
			return nil, huma.Error429TooManyRequests("wait a minute before requesting another code")
		}
		if errors.Is(err, emailverification.ErrChallengeNotFound) || errors.Is(err, emailverification.ErrAlreadyVerified) {
			return nil, huma.Error400BadRequest("verification request is invalid or expired")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to request another verification code")
		}
		return h.pendingEmailVerificationResponse(ctx, pending)
	})
}

func (h *AuthHandler) beginEmailVerification(
	ctx context.Context,
	user *models.User,
	create bool,
) (*AuthOutput, error) {
	if h.emailVerification == nil || h.emailSender == nil {
		return nil, huma.Error503ServiceUnavailable("email verification is not configured for this instance")
	}
	var (
		pending *emailverification.Pending
		err     error
	)
	if create {
		pending, err = h.emailVerification.Create(ctx, user.ID)
	} else {
		pending, err = h.emailVerification.CurrentOrCreate(ctx, user.ID)
	}
	if errors.Is(err, emailverification.ErrAlreadyVerified) {
		return h.issueAuthResponse(ctx, user)
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to start email verification")
	}
	return h.pendingEmailVerificationResponse(ctx, pending)
}

func (h *AuthHandler) pendingEmailVerificationResponse(
	ctx context.Context,
	pending *emailverification.Pending,
) (*AuthOutput, error) {
	status := "sent"
	if pending.Code != "" {
		err := h.emailSender.SendEmailVerification(ctx, passwordmail.VerificationMessage{
			Recipient:      pending.Email,
			Code:           pending.Code,
			ExpiresAt:      pending.Challenge.ExpiresAt,
			IdempotencyKey: "email-verification-" + pending.Challenge.ID,
		})
		if err != nil {
			status = "failed"
			log.Printf("email verification delivery failed for user %s: %v", pending.Challenge.UserID, err)
		} else if err := h.emailVerification.MarkSent(ctx, pending.Challenge.ID); err != nil {
			return nil, huma.Error500InternalServerError("failed to record email verification delivery")
		}
	} else if pending.Challenge.SentAt.IsZero() {
		status = "failed"
	}
	out := &AuthOutput{}
	out.Body.RequiresEmailVerification = true
	out.Body.EmailVerificationID = pending.Challenge.ID
	out.Body.EmailVerificationEmail = pending.Email
	out.Body.EmailDeliveryStatus = status
	return out, nil
}
