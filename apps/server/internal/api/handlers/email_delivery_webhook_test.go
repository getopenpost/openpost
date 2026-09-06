package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/workspaceteam"
	"github.com/stretchr/testify/require"
)

func TestEmailDeliveryWebhookAuthenticatesAndRedactsIdempotentEvidence(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceInvitation)(nil),
		(*models.WorkspaceInvitationDeliveryEvent)(nil),
	)
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	invitation := &models.WorkspaceInvitation{
		ID: "invitation-1", WorkspaceID: "workspace-1", Email: "secret-person@example.com",
		Role: "viewer", InvitedByUserID: "admin-1", TokenHash: "secret-token-hash",
		ExpiresAt: time.Now().UTC().Add(time.Hour), EmailDeliveryStatus: notifications.EmailDeliverySent,
		EmailDeliveryJobID: "delivery-1", CreatedAt: now,
	}
	_, err := db.NewInsert().Model(invitation).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	notificationService := notifications.NewService(db)
	teamService := workspaceteam.NewService(db, entitlements.NewSelfHostedService(), notificationService)
	NewEmailDeliveryWebhookHandler(teamService, "callback-secret").RegisterRoutes(e)
	body := []byte(`{"event_id":"provider-event-1","invitation_id":"invitation-1","delivery_id":"delivery-1","outcome":"delivered","occurred_at":"2026-08-14T12:01:00Z","provider_payload":"must not persist"}`)

	unauthorized := httptest.NewRecorder()
	e.ServeHTTP(unauthorized, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/email/delivery/webhook", bytes.NewReader(body)))
	require.Equal(t, http.StatusUnauthorized, unauthorized.Code)
	for _, signature := range []string{
		strings.TrimPrefix(signedEmailCallback(body), "v1="),
		strings.ToUpper(signedEmailCallback(body)),
	} {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/email/delivery/webhook", bytes.NewReader(body))
		request.Header.Set("OpenPost-Signature", signature)
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		require.Equal(t, http.StatusUnauthorized, response.Code)
	}

	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/email/delivery/webhook", bytes.NewReader(body))
	request.Header.Set("OpenPost-Signature", signedEmailCallback(body))
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), `"applied":true`)

	duplicate := httptest.NewRecorder()
	request = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/email/delivery/webhook", bytes.NewReader(body))
	request.Header.Set("OpenPost-Signature", signedEmailCallback(body))
	e.ServeHTTP(duplicate, request)
	require.Equal(t, http.StatusOK, duplicate.Code)
	require.Contains(t, duplicate.Body.String(), `"duplicate":true`)

	var event models.WorkspaceInvitationDeliveryEvent
	require.NoError(t, db.NewSelect().Model(&event).Where("event_id = ?", "provider-event-1").Scan(t.Context()))
	require.NotContains(t, event.EventID+event.InvitationID+event.DeliveryID+event.Outcome, "secret-person")
	require.NotContains(t, event.EventID+event.InvitationID+event.DeliveryID+event.Outcome, "secret-token")
}

func signedEmailCallback(body []byte) string {
	mac := hmac.New(sha256.New, []byte("callback-secret"))
	_, _ = mac.Write(body)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}
