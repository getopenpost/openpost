package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/oauth2messaging"
	"github.com/stretchr/testify/require"
)

func TestXMessagingWebhookUsesRawOAuth2SignatureAndBoundsBody(t *testing.T) {
	t.Parallel()
	service := oauth2messaging.NewService(nil, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), oauth2messaging.Config{ClientSecret: "messaging-secret"}, nil)
	e := echo.New()
	NewXMessagingHandler(nil, service).RegisterWebhook(e)
	crc := httptest.NewRecorder()
	e.ServeHTTP(crc, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/webhooks/x/messaging?crc_token=challenge-token", nil))
	require.Equal(t, 200, crc.Code)
	var body map[string]string
	require.NoError(t, json.Unmarshal(crc.Body.Bytes(), &body))
	require.Equal(t, "sha256=pMw9XZ7TG/roMem/fjM095IF1ut5uh9H3sUEAZXMKxQ=", body["response_token"])
	payload := `{"data":{"event_uuid":"encrypted-event","event_type":"chat.received","payload":{"text":"not plaintext"}}}`
	signature := "sha256=DchINHoIbn4ii5sOARBS975TYNWZ8u4ZDJXSc4rp9c8="
	for _, test := range []struct {
		name, oauth2, legacy, payload string
		want                          int
	}{
		{"signed encrypted event is acknowledged without importing", signature, "", payload, 200},
		{"modified raw bytes invalidate signature", signature, "", payload + " ", 401},
		{"valid legacy cannot bypass invalid OAuth2", "sha256=invalid", signature, payload, 401},
		{"legacy-only signature cannot authorize supplemental app", "", signature, payload, 401},
		{"oversized body rejected before JSON", "sha256=invalid", "", strings.Repeat("a", (1<<20)+1), 413},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/webhooks/x/messaging", strings.NewReader(test.payload))
			req.Header.Set("X-Twitter-Webhooks-Signature-OAuth2", test.oauth2)
			req.Header.Set("X-Twitter-Webhooks-Signature", test.legacy)
			out := httptest.NewRecorder()
			e.ServeHTTP(out, req)
			require.Equal(t, test.want, out.Code)
		})
	}
}
