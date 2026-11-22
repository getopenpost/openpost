package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
)

func TestMCPStructuredResultsReachTextOnlyClients(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	for _, endpoint := range []string{"/mcp", "/mcp/code"} {
		t.Run(endpoint, func(t *testing.T) {
			name, args := "list_workspaces", map[string]any{}
			if endpoint == "/mcp/code" {
				name, args = "query_operation", map[string]any{"operation": name, "arguments": args}
			}
			resp := srv.requestPath(t, endpoint, "web-token", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}})
			require.Equal(t, http.StatusOK, resp.Code)
			var out struct {
				Result struct {
					Content []struct {
						Type string `json:"type"`
						Text string `json:"text"`
					} `json:"content"`
					Structured json.RawMessage `json:"structuredContent"`
				} `json:"result"`
			}
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			require.Len(t, out.Result.Content, 2)
			require.Contains(t, out.Result.Content[0].Text, "workspace")
			require.Equal(t, "text", out.Result.Content[1].Type)
			require.JSONEq(t, string(out.Result.Structured), out.Result.Content[1].Text)
			require.Contains(t, out.Result.Content[1].Text, "ws-1")
			require.Contains(t, out.Result.Content[1].Text, "Launch")
		})
	}
}

const compatibilityPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func TestMCPBase64UploadThroughHTTP(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	call := func(endpoint, name, content string) map[string]any {
		args := map[string]any{"workspace_id": " ws-1 ", "filename": "../launch.png", "content_base64": content, "alt_text": "Launch image"}
		if name == "execute_operation" {
			args = map[string]any{"operation": "upload_media_base64", "arguments": args}
		}
		resp := srv.requestPath(t, endpoint, "web-token", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}})
		require.Equal(t, http.StatusOK, resp.Code)
		var out map[string]any
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
		require.NotContains(t, out, "error", resp.Body.String())
		return out["result"].(map[string]any)["structuredContent"].(map[string]any)["media"].(map[string]any)
	}
	png, err := base64.StdEncoding.DecodeString(compatibilityPNG)
	require.NoError(t, err)
	expectedBytes := make([]byte, 8*1024*1024)
	copy(expectedBytes, png)
	content := base64.StdEncoding.EncodeToString(expectedBytes)
	first := call("/mcp", "upload_media_base64", content)
	require.Equal(t, float64(8*1024*1024), first["size"])
	require.Equal(t, "image/png", first["mime_type"])
	require.Equal(t, "launch.png", first["original_filename"])
	require.Equal(t, "Launch image", first["alt_text"])
	require.Equal(t, float64(1), first["width"])
	var stored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", first["id"]).Scan(t.Context()))
	file, err := srv.handler.mediaHandler.storage.Open(t.Context(), filepath.Base(stored.FilePath))
	require.NoError(t, err)
	storedBytes, err := io.ReadAll(file)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	require.Equal(t, expectedBytes, storedBytes)
	second := call("/mcp/code", "execute_operation", "data:image/png;base64,"+content)
	require.Equal(t, float64(8*1024*1024), second["size"])
	require.Equal(t, first["id"], second["id"])
	require.Equal(t, true, second["deduped"])
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

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

func TestMCPFacebookCarouselPublicMediaValidation(t *testing.T) {
	t.Parallel()

	for _, status := range []int{http.StatusOK, http.StatusNotFound} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			t.Parallel()
			srv := newMCPTestServer(t)
			srv.handler.auth = mcpScopeAuthenticator{
				"mcp-token": {UserID: "user-1", Scope: "mcp:full", WorkspaceID: "ws-1"},
			}
			signer := mediasigner.New("carousel-test-signing-key")
			var requests atomic.Int32
			mediaServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mediaID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/media/"), ".jpg")
				expiresAt, _ := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
				if r.Method != http.MethodHead || !signer.Verify(mediaID, r.URL.Query().Get("sig"), expiresAt) {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				requests.Add(1)
				w.WriteHeader(status)
			}))
			t.Cleanup(mediaServer.Close)
			verifier := publicurl.NewMediaVerifier(mediaServer.URL+"/media", srv.handler.mediaStorage, signer)
			verifier.SetVerifier(publicurl.HTTPVerifier{Client: mediaServer.Client()})
			srv.handler.SetPublicMediaVerifier(verifier)

			_, err := srv.db.NewInsert().Model(&models.SocialAccount{
				ID: "facebook-page", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "page-1",
				Slug: "facebook-page", AccessTokenEnc: []byte("token"),
				GrantedScopes: "pages_manage_posts,pages_read_engagement", IsActive: true,
			}).Exec(t.Context())
			require.NoError(t, err)
			ensurePermissiveProviderReadinessFixture(t, srv.db)
			srv.handler.SetProviderReadiness(permissiveProviderReadiness(t))
			media := []models.MediaAttachment{
				{ID: "image-1", WorkspaceID: "ws-1", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, FilePath: "image-1.jpg", OriginalFilename: "image-1.jpg", ProcessingStatus: "ready"},
				{ID: "image-2", WorkspaceID: "ws-1", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, FilePath: "image-2.jpg", OriginalFilename: "image-2.jpg", ProcessingStatus: "ready"},
			}
			_, err = srv.db.NewInsert().Model(&media).Exec(t.Context())
			require.NoError(t, err)

			call := func(tool, operation string, args map[string]any) map[string]any {
				t.Helper()
				response := srv.requestPath(t, "/mcp/code", "mcp-token", map[string]any{
					"jsonrpc": "2.0", "id": operation, "method": "tools/call",
					"params": map[string]any{"name": tool, "arguments": map[string]any{"operation": operation, "arguments": args}},
				})
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var out map[string]any
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &out))
				return out
			}
			created := mcpStructuredContent(t, call("execute_operation", "create_post", map[string]any{
				"workspace_id": "ws-1", "content_profile": "carousel", "source_text": "Launch photos",
				"social_account_ids": []string{"facebook-page"}, "media_ids": []string{"image-1", "image-2"},
				"scheduled_at": time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339),
			}))
			post := created["publication"].(map[string]any)
			postID := post["id"].(string)
			validated := mcpStructuredContent(t, call("query_operation", "validate_post", map[string]any{"post_id": postID}))
			ready := status == http.StatusOK
			require.Equal(t, ready, validated["valid"], "validation issues: %v", validated["issues"])
			require.EqualValues(t, 2, requests.Load(), "validation must check both signed public media URLs")
			if !ready {
				issues := validated["issues"].([]any)
				codes := make([]string, 0, len(issues))
				for _, issue := range issues {
					codes = append(codes, issue.(map[string]any)["code"].(string))
				}
				require.Contains(t, codes, "public_url_unreachable")
			}
			for _, id := range []string{"image-1", "image-2"} {
				var persisted models.MediaAttachment
				require.NoError(t, srv.db.NewSelect().Model(&persisted).Where("id = ?", id).Scan(t.Context()))
				require.Equal(t, ready, persisted.PublicURLReady)
				require.False(t, persisted.PublicURLCheckedAt.IsZero())
				require.Equal(t, status, persisted.PublicURLStatus)
			}
			scheduled := call("execute_operation", "schedule_post", map[string]any{"post_id": postID, "expected_revision": post["revision"]})
			if ready {
				result := mcpStructuredContent(t, scheduled)
				require.Equal(t, "scheduled", result["publication"].(map[string]any)["status"])
				require.NotEmpty(t, result["job_id"])
			} else {
				require.Contains(t, mcpErrorMessage(t, scheduled), "validation")
				jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", postID).Count(t.Context())
				require.NoError(t, err)
				require.Zero(t, jobs)
			}
		})
	}
}
