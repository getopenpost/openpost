package handlers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/posttext"
	"github.com/stretchr/testify/require"
)

type mentionLookupTestAdapter struct {
	platform.Adapter
	target posttext.MentionTarget
	calls  int
}

func (a *mentionLookupTestAdapter) LookupMentions(_ context.Context, _ string, query string) ([]platform.MentionCandidate, error) {
	a.calls++
	return []platform.MentionCandidate{{Label: "@alice", Detail: query, Target: a.target}}, nil
}
func TestMCPMentionLookupAndAuthoredThreadRoundTrip(t *testing.T) {
	srv := newMCPTestServer(t)
	target := posttext.MentionTarget{Provider: "bluesky", Kind: "person", ID: "did:plc:ewvi7nxzyoun6zhxrhs64oiz"}
	adapter := &mentionLookupTestAdapter{target: target}
	tokens := &destinationOptionsTokenSource{}
	srv.handler.SetProviderCatalog(map[string]platform.Adapter{"bluesky": adapter}, false)
	srv.handler.SetTokenSource(tokens)
	call := func(name string, args map[string]any) map[string]any {
		response := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": name, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}})
		var output map[string]any
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output))
		require.NotContains(t, output, "error", response.Body.String())
		return output["result"].(map[string]any)["structuredContent"].(map[string]any)
	}
	lookup := call(mcpToolLookupMentions, map[string]any{"workspace_id": "ws-2", "account_id": "account-other-workspace", "query": "alice"})
	require.Len(t, lookup["candidates"], 1)
	require.Equal(t, "account-other-workspace", tokens.accountID)
	metadata := &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 8, End: 14, Text: "@alice", Target: target}}}
	created := call(mcpToolCreatePub, map[string]any{"workspace_id": "ws-2", "content_profile": "thread", "source_text": "🚀 Hi @alice", "detail": "full", "social_account_ids": []string{"account-other-workspace"}, "segments": []PublicationSegmentInput{{ID: "first", Body: "🚀 Hi @alice", Settings: map[string]any{"mentions": metadata}}, {ID: "tail", Body: "Thread tail"}}})
	data, err := json.Marshal(created["publication"])
	require.NoError(t, err)
	var publication PublicationResponse
	require.NoError(t, json.Unmarshal(data, &publication))
	require.Len(t, publication.Segments, 2)
	sourceID := publication.Segments[0].ID
	revision := publication.Revision
	updated := call(mcpToolUpdatePub, map[string]any{"post_id": publication.ID, "expected_revision": revision, "detail": "full", "segments": []PublicationSegmentInput{{ID: sourceID, Body: "A 🚀 Hi @alice"}, {ID: publication.Segments[1].ID, Body: "Thread tail"}}})
	data, err = json.Marshal(updated["publication"])
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(data, &publication))
	stored, err := posttext.Read(publication.Segments[0].Settings)
	require.NoError(t, err)
	require.Equal(t, 10, stored.Spans[0].Start)
	require.Equal(t, target.ID, stored.Spans[0].Target.ID)
	require.Equal(t, "Thread tail", publication.Segments[1].Body)
	// Workspace scoping applies before a provider lookup, including read-only clients.
	srv.handler.auth = mcpScopeAuthenticator{"read-token": {UserID: "user-1", Scope: "mcp:read", WorkspaceID: "ws-1"}}
	response := srv.request(t, "read-token", map[string]any{"jsonrpc": "2.0", "id": "wrong-workspace", "method": "tools/call", "params": map[string]any{"name": mcpToolLookupMentions, "arguments": map[string]any{"workspace_id": "ws-1", "account_id": "account-other-workspace", "query": "alice"}}})
	require.Contains(t, response.Body.String(), "connected account not found in this workspace")
	require.Equal(t, 1, adapter.calls)
	count, err := srv.db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}
