package platform

import (
	"context"

	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"

	"testing"

	"github.com/stretchr/testify/require"
)

type messagingQuotaProbe struct {
	observationError   error
	denied             error
	reserved, observed int
}

func (q *messagingQuotaProbe) ReserveXMessagingRequest(_ context.Context, user, operation string) error {
	q.reserved++
	if user != "111" || operation != XMessagingSend {
		return errors.New("incorrect quota identity")
	}
	return q.denied
}
func (q *messagingQuotaProbe) ObserveXMessagingResponse(_ context.Context, _, _ string, _ int, _ http.Header) error {
	q.observed++
	return q.observationError
}

func TestConfirmedXSendSurvivesQuotaObservationFailure(t *testing.T) {
	for _, variant := range []string{"oauth1", "oauth2"} {
		t.Run(variant, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests++
				w.Header().Set("x-rate-limit-remaining", "0")
				_, _ = fmt.Fprint(w, `{"data":{"dm_event_id":"confirmed"}}`)
			}))
			defer server.Close()
			original := httpClient
			httpClient = server.Client()
			defer func() { httpClient = original }()
			adapter := NewXAdapter("consumer", "secret", "")
			defer close(adapter.cleanupDone)
			adapter.apiBaseURL = server.URL
			quota := &messagingQuotaProbe{observationError: errors.New("quota storage unavailable")}
			adapter.SetMessagingQuotaGate(quota)
			token := "access|secret"
			if variant == "oauth2" {
				token = XMessagingOAuth2Token("supplemental")
			}
			input := SendMessageRequest{AccountID: "111", RemoteConversationID: "111-222", Body: "hello"}
			result, err := adapter.SendMessage(t.Context(), token, input)
			require.NoError(t, err)
			require.Equal(t, "confirmed", result.RemoteMessageID)
			_, err = adapter.SendMessage(t.Context(), token, input)
			require.Error(t, err)
			require.Equal(t, 1, requests, "no more upstream writes until the observation persists")
			quota.observationError = nil
			_, err = adapter.SendMessage(t.Context(), token, input)
			require.NoError(t, err)
			require.Equal(t, 2, requests)
		})
	}
}
