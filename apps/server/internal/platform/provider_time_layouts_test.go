package platform

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// X returns DM event timestamps with fractional seconds, which time.RFC3339
// rejects. The collected message must keep its sent time.
func TestNativePostAndMessageTimesSurviveProviderLayouts(t *testing.T) {
	t.Run("x direct message", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/2/dm_events", r.URL.Path)
			_, _ = io.WriteString(w, `{"data":[{"id":"event-1","text":"hello","created_at":"2026-10-20T09:00:00.000Z","sender_id":"222","dm_conversation_id":"111-222","event_type":"MessageCreate"}],"includes":{"users":[{"id":"222","username":"friend","name":"Friend"}]}}`)
		}))
		defer server.Close()
		adapter := NewXAdapter("consumer", "secret", "")
		defer close(adapter.cleanupDone)
		adapter.apiBaseURL = server.URL
		result, err := adapter.FetchMessages(t.Context(), "access|secret", FetchMessagesRequest{AccountID: "111"})
		require.NoError(t, err)
		require.Len(t, result.Conversations, 1)
		require.Len(t, result.Conversations[0].Messages, 1)
		require.True(t, result.Conversations[0].Messages[0].RemoteCreatedAt.Equal(time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)))
	})

	// Mastodon status timestamps include milliseconds too.
	t.Run("mastodon native post", func(t *testing.T) {
		original := httpClient
		t.Cleanup(func() { httpClient = original })
		httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			require.Contains(t, r.URL.Path, "/api/v1/accounts/me/statuses")
			return jsonResponse(r, `[{"id":"1","created_at":"2026-10-20T09:00:00.000Z","content":"<p>hello</p>","url":"https://social.example/@me/1","account":{"id":"me"}}]`), nil
		})}
		reader, ok := NewNativePostReader("mastodon", "https://social.example")
		require.True(t, ok)
		page, err := reader.ListNativePosts(t.Context(), "token", NativePostRequest{AccountID: "me", InstanceURL: "https://social.example", PageSize: 10})
		require.NoError(t, err)
		require.Len(t, page.Items, 1, "a fractional status timestamp must not skip the post")
		require.True(t, page.Items[0].PublishedAt.Equal(time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)))
	})
}
