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

func TestInstagramLoginConversationsUseDirectLoginRoute(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "graph.instagram.com", r.URL.Host)
		require.Equal(t, "/v25.0/me/conversations", r.URL.Path)
		require.Empty(t, r.URL.Query().Get("platform"))
		require.Equal(t, "participants,updated_time,messages.limit(100){"+metaMessageFields+"}", r.URL.Query().Get("fields"))
		return jsonResponse(r, `{"data":[]}`), nil
	})}
	_, err := NewInstagramLoginAdapter("", "", "").FetchMessages(t.Context(), "secret", FetchMessagesRequest{AccountID: "me"})
	require.NoError(t, err)
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
		require.Equal(t, "graph.facebook.com", r.URL.Host)
		require.Equal(t, "/v25.0/c1/messages", r.URL.Path)
		require.Equal(t, "Bearer secret", r.Header.Get(headerAuthorization))
		return jsonResponse(r, `{"data":[{"id":"m1","message":"old","from":{"id":"alice"},"created_time":"2026-10-20T09:00:00+0000"}]}`), nil
	})}
	result, err := NewInstagramAdapter("", "", "").FetchMessageHistory(t.Context(), "secret", FetchMessageHistoryRequest{AccountID: "me", ConversationID: "c1"})
	require.NoError(t, err)
	require.Len(t, result.Messages, 1)
	require.True(t, result.Messages[0].RemoteCreatedAt.Equal(time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)))
}

func TestInstagramLoginHistoryUsesConversationNodeEndpoint(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requests++
		require.Equal(t, "graph.instagram.com", r.URL.Host)
		require.Equal(t, "/v25.0/c1", r.URL.Path)
		require.Equal(t, "Bearer secret", r.Header.Get(headerAuthorization))
		require.Empty(t, r.URL.Query().Get("limit"))
		if requests == 1 {
			require.Equal(t, "messages.limit(20){"+metaMessageFields+"}", r.URL.Query().Get("fields"))
			return jsonResponse(r, `{"messages":{"data":[{"id":"m1","message":"hello","from":{"id":"alice"},"created_time":"2026-10-20T09:00:00+0000"}],"paging":{"next":"https://graph.instagram.com/v25.0/c1?after=cursor_2","cursors":{"after":"cursor_2"}}}}`), nil
		}
		require.Equal(t, 2, requests)
		require.Equal(t, "messages.after(cursor_2).limit(20){"+metaMessageFields+"}", r.URL.Query().Get("fields"))
		return jsonResponse(r, `{"messages":{"data":[{"id":"m2","message":"older","from":{"id":"alice"},"created_time":"2026-10-19T09:00:00+0000"}]}}`), nil
	})}
	adapter := NewInstagramLoginAdapter("", "", "")
	result, err := adapter.FetchMessageHistory(t.Context(), "secret", FetchMessageHistoryRequest{AccountID: "me", ConversationID: "c1", Limit: 20})
	require.NoError(t, err)
	require.Len(t, result.Messages, 1)
	require.Equal(t, []string{"m1"}, []string{result.Messages[0].ID})
	require.Equal(t, "cursor_2", result.NextCursor)
	page, err := adapter.FetchMessageHistory(t.Context(), "secret", FetchMessageHistoryRequest{AccountID: "me", ConversationID: "c1", Limit: 20, Cursor: result.NextCursor})
	require.NoError(t, err)
	require.Len(t, page.Messages, 1)
	require.Equal(t, "m2", page.Messages[0].ID)
	require.Equal(t, 2, requests)
}

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
