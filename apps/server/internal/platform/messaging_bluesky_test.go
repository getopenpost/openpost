package platform

import (
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// chat.bsky.convo.getMessages returns a union of messageView,
// deletedMessageView (a message the viewer deleted for themselves) and
// systemMessageView (group events such as a member joining). Only
// messageView carries text from a sender.
func TestBlueskyFetchMessagesSkipsDeletedAndSystemMessages(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, blueskyChatProxy, req.Header.Get("atproto-proxy"))
		switch {
		case strings.Contains(req.URL.Path, "chat.bsky.convo.listConvos"):
			return jsonResponse(req, `{"convos":[{"id":"convo-1","rev":"1","muted":false,"unreadCount":1,
				"members":[{"did":"did:plc:me","handle":"me.bsky.social"},{"did":"did:plc:alice","handle":"alice.bsky.social","displayName":"Alice"}],
				"lastMessage":{"$type":"chat.bsky.convo.defs#messageView","id":"m4","rev":"4","text":"hi back","sender":{"did":"did:plc:me"},"sentAt":"2026-09-01T10:04:00Z"}}]}`), nil
		case strings.Contains(req.URL.Path, "chat.bsky.convo.getMessages"):
			return jsonResponse(req, `{"messages":[
				{"$type":"chat.bsky.convo.defs#messageView","id":"m4","rev":"4","text":"hi back","sender":{"did":"did:plc:me"},"sentAt":"2026-09-01T10:04:00Z"},
				{"$type":"chat.bsky.convo.defs#systemMessageView","id":"m3","rev":"3","sentAt":"2026-09-01T10:03:00Z","data":{"$type":"chat.bsky.convo.defs#systemMessageDataMemberJoin","member":{"did":"did:plc:bob"}}},
				{"$type":"chat.bsky.convo.defs#deletedMessageView","id":"m2","rev":"2","sender":{"did":"did:plc:alice"},"sentAt":"2026-09-01T10:02:00Z"},
				{"$type":"chat.bsky.convo.defs#messageView","id":"m1","rev":"1","text":"hello","sender":{"did":"did:plc:alice"},"sentAt":"2026-09-01T10:01:00Z"}
			]}`), nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	result, err := NewBlueskyAdapter("").FetchMessages(t.Context(), "access", FetchMessagesRequest{AccountID: "did:plc:me", Limit: 100})
	require.NoError(t, err)
	require.Len(t, result.Conversations, 1)
	messages := result.Conversations[0].Messages
	require.Len(t, messages, 2)
	require.Equal(t, "m1", messages[0].ID)
	require.Equal(t, "inbound", messages[0].Direction)
	require.Equal(t, "hello", messages[0].Body)
	require.Equal(t, "m4", messages[1].ID)
	require.Equal(t, "outbound", messages[1].Direction)
	require.Equal(t, "hi back", messages[1].Body)
}
