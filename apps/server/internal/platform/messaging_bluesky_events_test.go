package platform

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBlueskyIncrementalEvents(t *testing.T) {
	adapter, ok := any(NewBlueskyAdapter("https://pds.example")).(IncrementalMessagingAdapter)
	require.True(t, ok, "Bluesky must read its account log instead of polling every history")
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "Bearer secret", r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/xrpc/chat.bsky.convo.getLog":
			require.Equal(t, "r1", r.URL.Query().Get("cursor"))
			require.Empty(t, r.URL.Query().Get("limit"), "getLog does not declare a limit parameter")
			return jsonResponse(r, `{"cursor":"r7","logs":[
    {"$type":"chat.bsky.convo.defs#logCreateMessage","rev":"r2","convoId":"c1","message":{"$type":"chat.bsky.convo.defs#messageView","id":"m2","text":"hello","sentAt":"2026-10-20T10:00:00Z","sender":{"did":"alice"}}},
    {"$type":"chat.bsky.convo.defs#logDeleteMessage","rev":"r3","convoId":"c1","message":{"id":"m1"}},
    {"$type":"chat.bsky.convo.defs#logReadMessage","rev":"r4","convoId":"c1","message":{"id":"m2","sender":{"did":"alice"}}},
    {"$type":"chat.bsky.convo.defs#logAddReaction","rev":"r5","convoId":"c1","message":{"id":"m2"},"reaction":{"value":"❤","sender":{"did":"me"}}},
    {"$type":"chat.bsky.convo.defs#logRemoveReaction","rev":"r6","convoId":"c1","message":{"id":"m2"},"reaction":{"value":"❤","sender":{"did":"me"}}},
    {"$type":"chat.bsky.convo.defs#logFutureThing","rev":"r7","convoId":"c1"}
   ]}`), nil
		case "/xrpc/chat.bsky.convo.getConvo":
			calls++
			return jsonResponse(r, `{"convo":{"id":"c1","unreadCount":0,"members":[{"did":"me"},{"did":"alice","handle":"alice.test"}],"lastMessage":{"id":"m2","text":"hello","sentAt":"2026-10-20T10:00:00Z"}}}`), nil
		default:
			t.Fatalf("unexpected history request %s", r.URL.Path)
			return nil, nil
		}
	})}
	batch, err := adapter.FetchMessageEvents(t.Context(), "secret", FetchMessageEventsRequest{AccountID: "me", Cursor: "r1", Limit: 100})
	require.NoError(t, err)
	require.Equal(t, "r7", batch.NextCursor)
	require.True(t, batch.HasMore, "nonempty log needs a drain probe independent of fixed server page size")
	require.Equal(t, 1, calls)
	require.Len(t, batch.Conversations, 1)
	require.Equal(t, "m2", batch.Conversations[0].Messages[0].ID)
	require.Equal(t, []DeletedProviderMessage{{ConversationID: "c1", MessageID: "m1"}}, batch.DeletedMessages)
	require.Equal(t, "me", batch.ReadStates[0].ActorRemoteID, "read logs mean viewer read, not message sender read")
	require.Len(t, batch.Reactions, 2)
	require.False(t, batch.Reactions[0].Deleted)
	require.True(t, batch.Reactions[1].Deleted)
}

func TestBlueskyBootstrapAndBoundedReplay(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	cursors := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "/xrpc/chat.bsky.convo.getLog", r.URL.Path, "bootstrap must not fetch any histories")
		cursor := r.URL.Query().Get("cursor")
		cursors = append(cursors, cursor)
		switch cursor {
		case "":
			return jsonResponse(r, `{"cursor":"r10","logs":[{"$type":"chat.bsky.convo.defs#logFuture","rev":"r9"}]}`), nil
		case "r10":
			return jsonResponse(r, `{"logs":[{"$type":"chat.bsky.convo.defs#logFuture","rev":"r11"},{"$type":"chat.bsky.convo.defs#logFuture","rev":"r12"}]}`), nil
		case "r11":
			return jsonResponse(r, `{"logs":[{"$type":"chat.bsky.convo.defs#logFuture","rev":"r12"}]}`), nil
		default:
			return jsonResponse(r, `{"logs":[]}`), nil
		}
	})}
	adapter := NewBlueskyAdapter("https://pds.example")
	batch, err := adapter.FetchMessageEvents(t.Context(), "token", FetchMessageEventsRequest{AccountID: "me"})
	require.NoError(t, err)
	require.True(t, batch.Bootstrap)
	require.Equal(t, "r10", batch.NextCursor)
	require.False(t, batch.HasMore)
	require.Empty(t, batch.Conversations)
	for _, expected := range []string{"r11", "r12", "r12"} {
		batch, err = adapter.FetchMessageEvents(t.Context(), "token", FetchMessageEventsRequest{AccountID: "me", Cursor: batch.NextCursor, Limit: 1})
		require.NoError(t, err)
		require.Equal(t, expected, batch.NextCursor)
	}
	require.False(t, batch.HasMore)
	require.Equal(t, []string{"", "r10", "r11", "r12"}, cursors)
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) { return jsonResponse(r, `{"logs":[]}`), nil })}
	_, err = adapter.FetchMessageEvents(t.Context(), "token", FetchMessageEventsRequest{AccountID: "me"})
	require.ErrorIs(t, err, ErrMessageBootstrapCursorRequired)
}

func TestBlueskyDiscoveryDoesNotFetchHistory(t *testing.T) {
	previous := httpClient
	t.Cleanup(func() { httpClient = previous })
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "/xrpc/chat.bsky.convo.listConvos", r.URL.Path)
		return jsonResponse(r, `{"convos":[{"id":"c1","members":[{"did":"me"},{"did":"alice"}],"unreadCount":1,"lastMessage":{"$type":"chat.bsky.convo.defs#messageView","id":"m1","text":"hello","sender":{"did":"alice"},"sentAt":"2026-10-20T10:00:00Z"}}],"cursor":"older"}`), nil
	})}
	batch, err := NewBlueskyAdapter("https://pds.example").FetchMessages(t.Context(), "token", FetchMessagesRequest{AccountID: "me", Limit: 20})
	require.NoError(t, err)
	require.Equal(t, "older", batch.NextCursor)
	require.Equal(t, "m1", batch.Conversations[0].Messages[0].ID)
}

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
