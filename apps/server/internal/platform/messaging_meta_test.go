package platform

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Graph returns created_time and updated_time with an offset without a colon,
// for example 2026-10-26T21:01:00+0000, which time.RFC3339 rejects.
func TestMetaConversationsParseGraphTimestamps(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "instagram", r.URL.Query().Get("platform"))
		return jsonResponse(r, `{"data":[{"id":"c1","updated_time":"2026-10-26T21:05:00+0000",
			"participants":{"data":[{"id":"me","username":"brand"},{"id":"alice","username":"alice"}]},
			"messages":{"data":[
				{"id":"m2","message":"thanks","from":{"id":"me"},"created_time":"2026-10-26T21:05:00+0000"},
				{"id":"m1","message":"hello","from":{"id":"alice"},"created_time":"2026-10-26T21:01:00+0000"}]}}]}`), nil
	})}
	result, err := NewInstagramAdapter("", "", "").FetchMessages(t.Context(), "secret", FetchMessagesRequest{AccountID: "me"})
	require.NoError(t, err)
	require.Len(t, result.Conversations, 1)
	conversation := result.Conversations[0]
	inbound := time.Date(2026, 10, 26, 21, 1, 0, 0, time.UTC)
	require.Equal(t, []string{"m1", "m2"}, []string{conversation.Messages[0].ID, conversation.Messages[1].ID})
	require.True(t, conversation.Messages[0].RemoteCreatedAt.Equal(inbound))
	require.True(t, conversation.LastMessageAt.Equal(time.Date(2026, 10, 26, 21, 5, 0, 0, time.UTC)))
	require.True(t, conversation.ReplyWindowExpiresAt.Equal(inbound.Add(24*time.Hour)))
}

func TestMetaConversationUsesUpdatedTimeWithoutMessages(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(r, `{"data":[{"id":"c1","updated_time":"2026-10-26T21:05:00+0000",
			"participants":{"data":[{"id":"me","username":"brand"},{"id":"alice","username":"alice"}]},
			"messages":{"data":[]}}]}`), nil
	})}
	result, err := NewInstagramAdapter("", "", "").FetchMessages(t.Context(), "secret", FetchMessagesRequest{AccountID: "me"})
	require.NoError(t, err)
	require.Len(t, result.Conversations, 1)
	require.Empty(t, result.Conversations[0].Messages)
	require.True(t, result.Conversations[0].LastMessageAt.Equal(time.Date(2026, 10, 26, 21, 5, 0, 0, time.UTC)))
}

func TestMetaHistoryParsesGraphTimestamps(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(r, `{"data":[{"id":"m1","message":"old","from":{"id":"alice"},"created_time":"2026-10-20T09:00:00+0000"}]}`), nil
	})}
	result, err := NewInstagramAdapter("", "", "").FetchMessageHistory(t.Context(), "secret", FetchMessageHistoryRequest{AccountID: "me", ConversationID: "c1"})
	require.NoError(t, err)
	require.True(t, result.Messages[0].RemoteCreatedAt.Equal(time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)))
}
