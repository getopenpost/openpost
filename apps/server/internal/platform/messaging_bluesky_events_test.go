package platform

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBlueskyLogCanAdvancePastInaccessibleConversation(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	status := http.StatusBadRequest
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/xrpc/chat.bsky.convo.getLog" {
			return jsonResponse(r, `{"logs":[{"$type":"chat.bsky.convo.defs#logReadConvo","rev":"r2","convoId":"gone","message":{"id":"m1"}},{"$type":"chat.bsky.convo.defs#logLeaveConvo","rev":"r3","convoId":"gone"}]}`), nil
		}
		response := jsonResponse(r, `{"error":"InvalidConvo"}`)
		response.StatusCode = status
		return response, nil
	})}
	adapter := NewBlueskyAdapter("https://pds.example")
	batch, err := adapter.FetchMessageEvents(t.Context(), "token", FetchMessageEventsRequest{AccountID: "me", Cursor: "r1", Limit: 1})
	require.NoError(t, err)
	require.Equal(t, "r2", batch.NextCursor)
	require.Equal(t, []string{"gone"}, batch.DeletedConversations)
	status = http.StatusServiceUnavailable
	_, err = adapter.FetchMessageEvents(t.Context(), "token", FetchMessageEventsRequest{AccountID: "me", Cursor: "r1", Limit: 1})
	require.Error(t, err, "an upstream outage cannot be treated as a deletion")
}
