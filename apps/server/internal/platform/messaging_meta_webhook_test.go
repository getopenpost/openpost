package platform

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMetaWebhookKeepsStoryReplyAttachment(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(r, `{"data":[{"id":"graph-conversation","participants":{"data":[{"id":"me"},{"id":"alice","name":"Alice"}]}}]}`), nil
	})}
	batch, err := NewInstagramAdapter("", "", "").NormalizeMessagingWebhook(t.Context(), "access", "me", json.RawMessage(`{"sender":{"id":"alice"},"recipient":{"id":"me"},"timestamp":1792490400000,"message":{"mid":"m1","text":"love this","reply_to":{"story":{"url":"https://cdn.example/story.jpg","id":"s1"}}}}`))
	require.NoError(t, err)
	require.Len(t, batch.Conversations, 1)
	message := batch.Conversations[0].Messages[0]
	require.Equal(t, "love this", message.Body)
	require.Equal(t, []MessageAttachment{{Type: "story_reply", URL: "https://cdn.example/story.jpg"}}, message.Attachments)
}

func TestMetaHistoryPaginatesWithoutFollowingCredentialedNextURL(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "graph.facebook.com", r.URL.Host)
		require.Equal(t, "older", r.URL.Query().Get("after"))
		return jsonResponse(r, `{"data":[{"id":"m1","message":"old","from":{"id":"alice"},"created_time":"2026-10-20T09:00:00Z"}],"paging":{"cursors":{"after":"terminal-but-no-next"}}}`), nil
	})}
	result, err := NewFacebookAdapter("", "", "").FetchMessageHistory(t.Context(), "secret", FetchMessageHistoryRequest{AccountID: "me", ConversationID: "graph-conversation", Cursor: "older"})
	require.NoError(t, err)
	require.Empty(t, result.NextCursor)
	require.Equal(t, "m1", result.Messages[0].ID)
}
