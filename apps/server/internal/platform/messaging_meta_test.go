package platform

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInstagramLoginHistoryRejectsCursorFieldInjection(t *testing.T) {
	requests := 0
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requests++
		return jsonResponse(r, `{}`), nil
	})}
	_, err := NewInstagramLoginAdapter("", "", "").FetchMessageHistory(t.Context(), "secret", FetchMessageHistoryRequest{ConversationID: "c1", Cursor: "cursor){id}"})
	require.ErrorContains(t, err, "invalid Instagram Login message cursor")
	require.Zero(t, requests)
}
