package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
)

const compatibilityPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func TestMCPBase64UploadRejectsInvalidOrUnauthorizedFiles(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ name, token, workspace, filename, content, mime, errorText string }{
		{"read scope", "read-token", "ws-1", "launch.png", compatibilityPNG, "", "mcp:read"},
		{"viewer", "web-token", "ws-1", "launch.png", compatibilityPNG, "", "editor"},
		{"outside workspace", "web-token", "ws-other", "launch.png", compatibilityPNG, "", "workspace"},
		{"bad base64", "web-token", "ws-1", "launch.png", "!!invalid!!", "", "base64"},
		{"empty", "web-token", "ws-1", "launch.png", "", "", "content_base64"},
		{"active document", "web-token", "ws-1", "launch.png", base64.StdEncoding.EncodeToString([]byte("<!DOCTYPE html><html><script>alert(1)</script></html>")), "image/png", "not supported"},
		{"MIME mismatch", "web-token", "ws-1", "launch.mp4", compatibilityPNG, "video/mp4", "does not match"},
		{"too large", "web-token", "ws-1", "launch.png", base64.StdEncoding.EncodeToString(make([]byte, 8*1024*1024+1)), "", "8 MiB"},
		{"invalid data URL", "web-token", "ws-1", "launch.png", "data:image/png," + compatibilityPNG, "", "base64"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newMCPTestServer(t)
			if tc.token == "read-token" {
				srv.handler.auth = mcpScopeAuthenticator{"read-token": {UserID: "user-1", Scope: "mcp:read", WorkspaceID: "ws-1"}}
			}
			if tc.name == "viewer" {
				_, err := srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").Exec(t.Context())
				require.NoError(t, err)
			}
			args := map[string]any{"workspace_id": tc.workspace, "filename": tc.filename, "content_base64": tc.content}
			if tc.mime != "" {
				args["mime_type"] = tc.mime
			}
			resp := srv.request(t, tc.token, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "upload_media_base64", "arguments": args}})
			require.Equal(t, http.StatusOK, resp.Code)
			var out struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			require.Contains(t, strings.ToLower(out.Error.Message), strings.ToLower(tc.errorText))
			count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count)
		})
	}
}

func TestMCPInboxReadsOrphansAndEnforcesScopeBeforeMutations(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	db := testdb.NewSQLite(t)
	for _, row := range []any{
		&models.User{ID: "user-1", Email: "inbox@example.test"},
		&models.Organization{ID: "organization-1", Name: "Inbox", CreatedByID: "user-1"},
		&models.Workspace{ID: "ws-1", Name: "Inbox", OrganizationID: "organization-1"},
		&models.Workspace{ID: "ws-2", Name: "Other", OrganizationID: "organization-1"},
		&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		&models.SocialAccount{ID: "account-1", WorkspaceID: "ws-1", Platform: "x", AccountID: "native-account", Slug: "inbox", AccessTokenEnc: []byte("synthetic"), IsActive: true},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	srv.db, srv.handler.db = db, db
	srv.handler.SetEngagementService(engagement.NewService(srv.db, nil, nil))
	srv.handler.auth = mcpScopeAuthenticator{
		"read":  {UserID: "user-1", Scope: "mcp:read", WorkspaceID: "ws-1"},
		"write": {UserID: "user-1", Scope: "mcp:full", WorkspaceID: "ws-1"},
	}
	items := []models.EngagementItem{
		{ID: "mention", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "x", Kind: "mention", RemoteID: "native-post", Body: "Incoming mention", SubjectJSON: `{"kind":"post","remote_id":"native-post"}`, LastSeenAt: time.Now().UTC()},
		{ID: "review", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "x", Kind: "review", RemoteID: "native-review", Body: "", SubjectJSON: `{"kind":"review","remote_id":"native-review","review":{"anonymous":true,"stars":5}}`, LastSeenAt: time.Now().UTC()},
	}
	_, err := srv.db.NewInsert().Model(&items).Exec(t.Context())
	require.NoError(t, err)
	call := func(token, tool string, args map[string]any) map[string]any {
		response := srv.request(t, token, map[string]any{"jsonrpc": "2.0", "id": tool, "method": "tools/call", "params": map[string]any{"name": tool, "arguments": args}})
		var output map[string]any
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output), response.Body.String())
		return output
	}
	listed := call("read", mcpToolInboxList, map[string]any{"workspace_id": "ws-1", "kind": "mention"})
	require.NotContains(t, listed, "error")
	data := listed["result"].(map[string]any)["structuredContent"].(map[string]any)
	require.Len(t, data["items"], 1)
	mention := data["items"].([]any)[0].(map[string]any)
	require.Equal(t, "mention", mention["id"])
	require.NotContains(t, mention, "rendition_id")
	denied := call("read", mcpToolInboxRead, map[string]any{"workspace_id": "ws-1", "kind": "mention"})
	require.Contains(t, denied, "error")
	denied = call("write", mcpToolInboxGet, map[string]any{"workspace_id": "ws-2", "item_id": "review"})
	require.Contains(t, denied, "error")
	updated := call("write", mcpToolInboxRead, map[string]any{"workspace_id": "ws-1", "kind": "mention"})
	require.NotContains(t, updated, "error")
	var review models.EngagementItem
	require.NoError(t, srv.db.NewSelect().Model(&review).Where("id='review'").Scan(t.Context()))
	require.True(t, review.ReadAt.IsZero(), "MCP bulk read uses the requested activity filter")
}

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
	t.Parallel()
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
