package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/services/notifications"
)

const emailDeliveryCallbackBodyLimit = 64 << 10

type EmailDeliveryWebhookHandler struct {
	notifications *notifications.Service
	secret        string
}

type emailDeliveryCallback struct {
	EventID      string    `json:"event_id"`
	InvitationID string    `json:"invitation_id"`
	DeliveryID   string    `json:"delivery_id"`
	Outcome      string    `json:"outcome"`
	OccurredAt   time.Time `json:"occurred_at"`
}

type emailDeliveryCallbackResponse struct {
	OK        bool `json:"ok"`
	Applied   bool `json:"applied"`
	Duplicate bool `json:"duplicate"`
	Ignored   bool `json:"ignored"`
}

func NewEmailDeliveryWebhookHandler(service *notifications.Service, secret string) *EmailDeliveryWebhookHandler {
	return &EmailDeliveryWebhookHandler{notifications: service, secret: strings.TrimSpace(secret)}
}

func (h *EmailDeliveryWebhookHandler) RegisterRoutes(e *echo.Echo) {
	e.POST("/api/v1/email/delivery/webhook", h.handle)
}

func (h *EmailDeliveryWebhookHandler) handle(c echo.Context) error {
	if h.notifications == nil || h.secret == "" {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "email delivery callbacks are not configured"})
	}
	body, err := io.ReadAll(io.LimitReader(c.Request().Body, emailDeliveryCallbackBodyLimit+1))
	if err != nil || len(body) > emailDeliveryCallbackBodyLimit {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid delivery callback"})
	}
	if !validEmailDeliveryCallbackSignature(h.secret, body, c.Request().Header.Get("OpenPost-Signature")) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid delivery callback signature"})
	}
	var callback emailDeliveryCallback
	if err := json.Unmarshal(body, &callback); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid delivery callback"})
	}
	result, err := h.notifications.RecordWorkspaceInvitationDelivery(c.Request().Context(), notifications.WorkspaceInvitationDeliveryEvent{
		EventID: callback.EventID, InvitationID: callback.InvitationID, DeliveryID: callback.DeliveryID,
		Outcome: callback.Outcome, OccurredAt: callback.OccurredAt,
	})
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid delivery callback"})
	}
	return c.JSON(http.StatusOK, emailDeliveryCallbackResponse{
		OK: true, Applied: result.Applied, Duplicate: result.Duplicate, Ignored: result.Ignored,
	})
}

func validEmailDeliveryCallbackSignature(secret string, body []byte, signature string) bool {
	signature = strings.TrimSpace(signature)
	if !strings.HasPrefix(signature, "v1=") {
		return false
	}
	provided := strings.TrimPrefix(signature, "v1=")
	if len(provided) != sha256.Size*2 || provided != strings.ToLower(provided) {
		return false
	}
	decoded, err := hex.DecodeString(provided)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hmac.Equal(decoded, mac.Sum(nil))
}
