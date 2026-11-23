package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// The bsky.social entryway answers proxied chat.bsky methods with 501
// MethodNotImplemented. Bluesky-hosted accounts must reach chat through the
// PDS host named in their DID document.
func TestBlueskyChatUsesTheAccountPDSForBlueskyHostedAccounts(t *testing.T) {
	const did = "did:plc:hostedexample00000000000"
	const plcURL = "https://plc.directory/" + did
	const pdsListURL = "https://morel.us-east.host.bsky.network/xrpc/chat.bsky.convo.listConvos?limit=20"
	stubBlueskyResolution(t, map[string]string{
		plcURL:     blueskyDIDDocument(did, "", "https://morel.us-east.host.bsky.network"),
		pdsListURL: `{"convos":[{"id":"convo-1","members":[{"did":"` + did + `"},{"did":"did:plc:alice","handle":"alice.bsky.social"}],"lastMessage":{"$type":"chat.bsky.convo.defs#messageView","id":"m1","text":"hi","sender":{"did":"did:plc:alice"},"sentAt":"2026-09-01T10:01:00Z"}}]}`,
	}, nil)

	adapter := NewBlueskyAdapter("")
	for range 2 {
		result, err := adapter.FetchMessages(t.Context(), "access", FetchMessagesRequest{AccountID: did, Limit: 20})
		require.NoError(t, err)
		require.Len(t, result.Conversations, 1)
		require.Equal(t, "convo-1", result.Conversations[0].ID)
	}
}
