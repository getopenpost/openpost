package handlers

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
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
	first := call("/mcp", "upload_media_base64", compatibilityPNG)
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
	expectedBytes, err := base64.StdEncoding.DecodeString(compatibilityPNG)
	require.NoError(t, err)
	require.Equal(t, expectedBytes, storedBytes)
	second := call("/mcp/code", "execute_operation", "data:image/png;base64,"+compatibilityPNG)
	require.Equal(t, first["id"], second["id"])
	require.Equal(t, true, second["deduped"])
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
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

func TestMCPBase64UploadAcceptsEightMiBFile(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	png, err := base64.StdEncoding.DecodeString(compatibilityPNG)
	require.NoError(t, err)
	content := make([]byte, 8*1024*1024)
	copy(content, png)
	response := srv.requestPath(t, "/mcp/code", "web-token", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "execute_operation", "arguments": map[string]any{"operation": "upload_media_base64", "arguments": map[string]any{"workspace_id": "ws-1", "filename": "launch.png", "content_base64": base64.StdEncoding.EncodeToString(content)}}}})
	require.Equal(t, http.StatusOK, response.Code)
	var result struct {
		Error  *json.RawMessage `json:"error"`
		Result struct {
			Structured struct {
				Media struct {
					Size int64 `json:"size"`
				} `json:"media"`
			} `json:"structuredContent"`
		} `json:"result"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.Nil(t, result.Error, response.Body.String())
	require.Equal(t, int64(8*1024*1024), result.Result.Structured.Media.Size)
}
