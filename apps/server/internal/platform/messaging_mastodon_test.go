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

const mastodonConversationFixture = `{"id":"c1","unread":true,"accounts":[{"id":"alice","acct":"alice@test.social","display_name":"Alice"}],"last_status":{"id":"m2","visibility":"direct","content":"<p>hello</p>","created_at":"2026-10-20T10:00:00Z","account":{"id":"alice"}}}`

func TestMastodonRepairPreservesPaginationAndDirectVisibility(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	failContext := false
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/api/v1/conversations":
			require.Equal(t, "older", r.URL.Query().Get("max_id"))
			response := jsonResponse(r, "["+mastodonConversationFixture+"]")
			response.Header.Set("Link", `<https://hostile.invalid/api/v1/conversations?max_id=next>; rel="next"`)
			return response, nil
		case "/api/v1/statuses/m2/context":
			if failContext {
				return nil, errors.New("disconnected")
			}
			return jsonResponse(r, `{"ancestors":[{"id":"public","visibility":"public","content":"public context","created_at":"2026-10-20T09:00:00Z"},{"id":"m1","visibility":"direct","content":"earlier","created_at":"2026-10-20T09:01:00Z","account":{"id":"me"}}],"descendants":[]}`), nil
		default:
			t.Fatalf("unexpected follow of untrusted pagination URL: %s", r.URL)
			return nil, nil
		}
	})}
	adapter := NewMastodonAdapter("", "", "", "https://test.social")
	result, err := adapter.FetchMessages(t.Context(), "token", FetchMessagesRequest{AccountID: "me", Cursor: "older"})
	require.NoError(t, err)
	require.Equal(t, "next", result.NextCursor)
	require.Len(t, result.Conversations[0].Messages, 2)
	require.Equal(t, "m1", result.Conversations[0].Messages[0].ID)
	require.Equal(t, "m2", result.Conversations[0].Messages[1].ID)
	failContext = true
	_, err = adapter.FetchMessages(t.Context(), "token", FetchMessagesRequest{AccountID: "me", Cursor: "older"})
	require.Error(t, err, "failed repair must not acknowledge partial conversation history")
}

func TestMastodonStreamRepairsBeforeApplyingConversation(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(r, `{"ancestors":[],"descendants":[]}`), nil
	})}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer private-token", r.Header.Get("Authorization"))
		require.Empty(t, r.URL.RawQuery)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, ":heartbeat\n\nevent: conversation\ndata: "+mastodonConversationFixture+"\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	repaired := false
	stop := errors.New("stop after apply")
	adapter := NewMastodonAdapter("", "", "", "https://test.social")
	err := adapter.consumeMessageStream(t.Context(), server.Client(), server.URL, "private-token", "me", func(context.Context) error { repaired = true; return nil }, func(_ context.Context, batch FetchMessageEventsResult) error {
		require.True(t, repaired)
		require.Equal(t, "c1", batch.Conversations[0].ID)
		require.Equal(t, "m2", batch.Conversations[0].Messages[0].ID)
		return stop
	})
	require.ErrorIs(t, err, stop)
}

func TestMastodonStreamRejectsUnsafeDiscoveredHost(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Empty(t, r.Header.Get("Authorization"), "metadata discovery must not send account credentials")
		return jsonResponse(r, `{"configuration":{"urls":{"streaming":"wss://127.0.0.1"}}}`), nil
	})}
	adapter := NewMastodonAdapter("", "", "", "https://test.social")
	err := adapter.StreamMessageEvents(t.Context(), "private-token", "me", func(context.Context) error { return nil }, func(context.Context, FetchMessageEventsResult) error { return nil })
	require.ErrorContains(t, err, "private or local address")
}
