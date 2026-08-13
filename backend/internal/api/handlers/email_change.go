package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/emailchange"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/ratelimit"
)

const reauthActionEmailChange = "identity.email.change"

type EmailChangeReauth interface {
	ConsumeReauthGrant(ctx context.Context, raw, userID, sessionID, action string) error
}

type EmailChangeHandler struct {
	service       *emailchange.Service
	reauth        EmailChangeReauth
	sender        passwordmail.Sender
	authenticator middleware.Authenticator
	limiter       *ratelimit.Limiter
	publicURL     string
}

func NewEmailChangeHandler(
	service *emailchange.Service,
	reauth EmailChangeReauth,
	sender passwordmail.Sender,
	authenticator middleware.Authenticator,
	publicURL string,
) *EmailChangeHandler {
	return &EmailChangeHandler{
		service:       service,
		reauth:        reauth,
		sender:        sender,
		authenticator: authenticator,
		limiter:       ratelimit.New(),
		publicURL:     strings.TrimRight(strings.TrimSpace(publicURL), "/"),
	}
}

type EmailChangeSummary struct {
	ID        string    `json:"id" doc:"Email-change challenge ID"`
	NewEmail  string    `json:"new_email" doc:"Address awaiting confirmation"`
	ExpiresAt time.Time `json:"expires_at" doc:"Challenge expiration time"`
	SentAt    time.Time `json:"sent_at,omitempty" doc:"When the latest code was sent"`
}

type EmailChangeStatusOutput struct {
	Body struct {
		Pending *EmailChangeSummary `json:"pending,omitempty"`
	}
}

type BeginEmailChangeInput struct {
	Body struct {
		NewEmail    string `json:"new_email" format:"email" doc:"New sign-in email address"`
		ReauthGrant string `json:"reauth_grant" minLength:"1" doc:"One-time grant for identity.email.change"`
	}
}

type BeginEmailChangeOutput struct {
	Body EmailChangeSummary
}

type EmailChangeChallengeInput struct {
	ID string `path:"id" doc:"Email-change challenge ID"`
}

type ConfirmEmailChangeInput struct {
	ID   string `path:"id" doc:"Email-change challenge ID"`
	Body struct {
		Code string `json:"code" minLength:"6" maxLength:"6" pattern:"^[0-9]{6}$" doc:"Six-digit code sent to the new address"`
	}
}

type ConfirmEmailChangeOutput struct {
	Body struct {
		Email           string `json:"email" doc:"Confirmed sign-in email address"`
		RevokedSessions int64  `json:"revoked_sessions" doc:"Other sessions revoked after the identity change"`
	}
}

type CancelEmailChangeOutput struct {
	Body struct {
		Canceled bool `json:"canceled"`
	}
}

func (h *EmailChangeHandler) RegisterRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authenticator)
	huma.Register(api, huma.Operation{
		OperationID: "get-email-change",
		Method:      http.MethodGet,
		Path:        "/auth/email-change",
		Summary:     "Get the pending sign-in email change",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{authMiddleware},
	}, h.current)

	huma.Register(api, huma.Operation{
		OperationID:   "begin-email-change",
		Method:        http.MethodPost,
		Path:          "/auth/email-change",
		Summary:       "Send a verification code to a new sign-in email",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:        []int{400, 401, 409, 429, 503},
	}, h.begin)

	huma.Register(api, huma.Operation{
		OperationID: "resend-email-change",
		Method:      http.MethodPost,
		Path:        "/auth/email-change/{id}/resend",
		Summary:     "Send a new email-change verification code",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{400, 404, 429, 503},
	}, h.resend)

	huma.Register(api, huma.Operation{
		OperationID: "confirm-email-change",
		Method:      http.MethodPost,
		Path:        "/auth/email-change/{id}/confirm",
		Summary:     "Confirm and apply a sign-in email change",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{400, 404, 409, 429, 503},
	}, h.confirm)

	huma.Register(api, huma.Operation{
		OperationID: "cancel-email-change",
		Method:      http.MethodDelete,
		Path:        "/auth/email-change/{id}",
		Summary:     "Cancel a pending sign-in email change",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{404},
	}, h.cancel)
}

func (h *EmailChangeHandler) current(ctx context.Context, _ *struct{}) (*EmailChangeStatusOutput, error) {
	if h.service == nil {
		return &EmailChangeStatusOutput{}, nil
	}
	challenge, err := h.service.Current(ctx, middleware.GetUserID(ctx))
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load pending email change")
	}
	out := &EmailChangeStatusOutput{}
	if challenge != nil {
		summary := emailChangeSummary(challenge.ID, challenge.NewEmail, challenge.ExpiresAt, challenge.SentAt)
		out.Body.Pending = &summary
	}
	return out, nil
}

func (h *EmailChangeHandler) begin(ctx context.Context, input *BeginEmailChangeInput) (*BeginEmailChangeOutput, error) {
	if h.service == nil || h.reauth == nil || h.sender == nil {
		return nil, huma.Error503ServiceUnavailable("email change is not available")
	}
	userID := middleware.GetUserID(ctx)
	if !h.allow(userID, "begin", 5, 15*time.Minute) {
		return nil, huma.Error429TooManyRequests("too many email change requests")
	}
	if err := h.reauth.ConsumeReauthGrant(
		ctx,
		input.Body.ReauthGrant,
		userID,
		middleware.GetSessionID(ctx),
		reauthActionEmailChange,
	); err != nil {
		return nil, huma.Error401Unauthorized("recent reauthentication is required")
	}
	pending, err := h.service.Begin(ctx, userID, input.Body.NewEmail)
	if err != nil {
		return nil, emailChangeError(err)
	}
	if err := h.sendCode(ctx, pending); err != nil {
		_ = h.service.Cancel(ctx, userID, pending.Challenge.ID)
		return nil, huma.Error503ServiceUnavailable("confirmation email could not be delivered")
	}
	if err := h.service.MarkSent(ctx, userID, pending.Challenge.ID); err != nil {
		return nil, huma.Error500InternalServerError("failed to record confirmation delivery")
	}
	h.notifyOldAddress(ctx, pending.Challenge.OldEmail, pending.Challenge.NewEmail, pending.Challenge.ID, "requested")
	out := &BeginEmailChangeOutput{Body: emailChangeSummary(
		pending.Challenge.ID,
		pending.Challenge.NewEmail,
		pending.Challenge.ExpiresAt,
		time.Now().UTC(),
	)}
	return out, nil
}

func (h *EmailChangeHandler) resend(ctx context.Context, input *EmailChangeChallengeInput) (*BeginEmailChangeOutput, error) {
	if h.service == nil || h.sender == nil {
		return nil, huma.Error503ServiceUnavailable("email change is not available")
	}
	userID := middleware.GetUserID(ctx)
	if !h.allow(userID, "resend", 5, 15*time.Minute) {
		return nil, huma.Error429TooManyRequests("too many email change requests")
	}
	pending, err := h.service.Resend(ctx, userID, input.ID)
	if err != nil {
		return nil, emailChangeError(err)
	}
	if err := h.sendCode(ctx, pending); err != nil {
		return nil, huma.Error503ServiceUnavailable("confirmation email could not be delivered")
	}
	if err := h.service.MarkSent(ctx, userID, pending.Challenge.ID); err != nil {
		return nil, huma.Error500InternalServerError("failed to record confirmation delivery")
	}
	out := &BeginEmailChangeOutput{Body: emailChangeSummary(
		pending.Challenge.ID,
		pending.Challenge.NewEmail,
		pending.Challenge.ExpiresAt,
		time.Now().UTC(),
	)}
	return out, nil
}

func (h *EmailChangeHandler) confirm(ctx context.Context, input *ConfirmEmailChangeInput) (*ConfirmEmailChangeOutput, error) {
	if h.service == nil {
		return nil, huma.Error503ServiceUnavailable("email change is not available")
	}
	userID := middleware.GetUserID(ctx)
	if !h.allow(userID, "confirm", 10, 15*time.Minute) {
		return nil, huma.Error429TooManyRequests("too many email change attempts")
	}
	pending, currentErr := h.service.Current(ctx, userID)
	if currentErr != nil {
		return nil, huma.Error500InternalServerError("failed to load pending email change")
	}
	completion, err := h.service.Verify(ctx, userID, middleware.GetSessionID(ctx), input.ID, input.Body.Code)
	if err != nil {
		return nil, emailChangeError(err)
	}
	h.notifyCompletion(ctx, completion.User.Email, input.ID)
	if pending != nil && pending.ID == input.ID {
		h.notifyOldAddress(ctx, pending.OldEmail, completion.User.Email, input.ID, "completed")
	}
	out := &ConfirmEmailChangeOutput{}
	out.Body.Email = completion.User.Email
	out.Body.RevokedSessions = completion.RevokedSessions
	return out, nil
}

func (h *EmailChangeHandler) cancel(ctx context.Context, input *EmailChangeChallengeInput) (*CancelEmailChangeOutput, error) {
	if h.service == nil {
		return nil, huma.Error404NotFound("email change not found")
	}
	if err := h.service.Cancel(ctx, middleware.GetUserID(ctx), input.ID); err != nil {
		return nil, emailChangeError(err)
	}
	out := &CancelEmailChangeOutput{}
	out.Body.Canceled = true
	return out, nil
}

func (h *EmailChangeHandler) sendCode(ctx context.Context, pending *emailchange.Pending) error {
	return h.sender.SendNotification(ctx, passwordmail.NotificationMessage{
		Recipient: pending.Challenge.NewEmail,
		Title:     "Confirm your OpenPost sign-in email",
		Body: fmt.Sprintf(
			"Your confirmation code is %s. It expires in 15 minutes. Your current sign-in email remains active until you confirm this code.",
			pending.Code,
		),
		ActionURL:      h.settingsURL(),
		IdempotencyKey: "email-change-code:" + pending.Challenge.ID + ":" + pending.Challenge.CodeHash,
	})
}

func (h *EmailChangeHandler) notifyOldAddress(ctx context.Context, oldEmail, newEmail, challengeID, state string) {
	if h.sender == nil || strings.TrimSpace(oldEmail) == "" {
		return
	}
	title := "OpenPost sign-in email change requested"
	body := "A request was made to change your OpenPost sign-in email to " + newEmail + ". Your current address remains active until the new address is confirmed."
	if state == "completed" {
		title = "Your OpenPost sign-in email changed"
		body = "Your OpenPost sign-in email was changed to " + newEmail + ". If you did not make this change, contact your server administrator now."
	}
	if err := h.sender.SendNotification(ctx, passwordmail.NotificationMessage{
		Recipient:      oldEmail,
		Title:          title,
		Body:           body,
		ActionURL:      h.settingsURL(),
		IdempotencyKey: "email-change-" + state + ":" + challengeID,
	}); err != nil {
		log.Printf("email change %s notice delivery failed: %v", state, err)
	}
}

func (h *EmailChangeHandler) notifyCompletion(ctx context.Context, newEmail, challengeID string) {
	if h.sender == nil {
		return
	}
	if err := h.sender.SendNotification(ctx, passwordmail.NotificationMessage{
		Recipient:      newEmail,
		Title:          "Your OpenPost sign-in email changed",
		Body:           "This address is now your OpenPost sign-in email. Any other active browser sessions were signed out, and unused password-reset links were invalidated.",
		ActionURL:      h.settingsURL(),
		IdempotencyKey: "email-change-completed-new:" + challengeID,
	}); err != nil {
		log.Printf("email change completion notice delivery failed: %v", err)
	}
}

func (h *EmailChangeHandler) settingsURL() string {
	if h.publicURL == "" {
		return ""
	}
	return h.publicURL + "/settings?tab=security"
}

func (h *EmailChangeHandler) allow(userID, action string, limit int, window time.Duration) bool {
	return h.limiter.Allow("email-change:"+action+":"+strings.TrimSpace(userID), limit, window)
}

func emailChangeSummary(id, newEmail string, expiresAt, sentAt time.Time) EmailChangeSummary {
	return EmailChangeSummary{ID: id, NewEmail: newEmail, ExpiresAt: expiresAt, SentAt: sentAt}
}

func emailChangeError(err error) error {
	switch {
	case errors.Is(err, emailchange.ErrInvalidEmail):
		return huma.Error400BadRequest("invalid email address")
	case errors.Is(err, emailchange.ErrSameEmail), errors.Is(err, emailchange.ErrEmailUnavailable):
		return huma.Error409Conflict("that address cannot be used")
	case errors.Is(err, emailchange.ErrChallengeNotFound):
		return huma.Error404NotFound("email change not found")
	case errors.Is(err, emailchange.ErrChallengeExpired):
		return huma.Error400BadRequest("email change code expired")
	case errors.Is(err, emailchange.ErrInvalidCode):
		return huma.Error400BadRequest("invalid email change code")
	case errors.Is(err, emailchange.ErrTooManyAttempts), errors.Is(err, emailchange.ErrResendTooSoon):
		return huma.Error429TooManyRequests("too many email change attempts")
	case errors.Is(err, emailchange.ErrNotConfigured):
		return huma.Error503ServiceUnavailable("email change is not available")
	default:
		return huma.Error500InternalServerError("email change failed")
	}
}
