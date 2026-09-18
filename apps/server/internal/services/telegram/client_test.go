package telegram

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSetWebhookAcceptsTelegramBooleanResult(t *testing.T) {
	for _, tc := range []struct {
		name     string
		body     string
		accepted bool
	}{
		{name: "registered", body: `{"ok":true,"result":true}`, accepted: true},
		{name: "not registered", body: `{"ok":true,"result":false}`},
		{name: "rejected", body: `{"ok":false,"description":"Bad Request"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := SetWebhookRequest{
				URL:            "https://openpost.example/api/v1/webhooks/telegram",
				SecretToken:    "test-webhook-secret",
				AllowedUpdates: []string{"message", "channel_post", "my_chat_member", "message_reaction_count"},
			}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, http.MethodPost, r.Method)
				require.Equal(t, "/botlocal-test-token/setWebhook", r.URL.Path)
				var received SetWebhookRequest
				require.NoError(t, json.NewDecoder(r.Body).Decode(&received))
				require.Equal(t, request, received)
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, tc.body)
			}))
			defer provider.Close()
			api := NewHTTPBotAPI("local-test-token", provider.Client())
			api.baseURL = provider.URL
			err := api.SetWebhook(t.Context(), request)
			if tc.accepted {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
