package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type mcpTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	handler *MCPHandler
}

func newMCPTestServer(t *testing.T) *mcpTestServer {
	return newMCPTestServerWithEntitlement(t, nil)
}

func newMCPTestServerWithEntitlement(t *testing.T, entitlement entitlements.Service) *mcpTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.Job)(nil),
		(*models.UsageCounter)(nil),
		(*models.PostingSchedule)(nil),
		(*models.MediaAttachment)(nil),
		(*models.MCPToolCall)(nil),
		(*models.ProviderApp)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.PublicationLifecycleEvent)(nil),
	)
	ctx := context.Background()
	workspaces := []models.Workspace{
		{ID: "ws-1", Name: "Launch", CreatedAt: time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)},
		{ID: "ws-2", Name: "Personal", CreatedAt: time.Date(2026, 6, 30, 11, 0, 0, 0, time.UTC)},
	}
	_, err := db.NewInsert().Model(&workspaces).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "ws-2", UserID: "user-1", Role: models.WorkspaceRoleEditor},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{
			ID:              "account-1",
			WorkspaceID:     "ws-1",
			Platform:        "x",
			AccountID:       "x-1",
			AccountUsername: "openpost",
			Slug:            "x-openpost",
			AccessTokenEnc:  []byte("token"),
			IsActive:        true,
			CreatedAt:       time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC),
		},
		{
			ID:             "account-inactive",
			WorkspaceID:    "ws-1",
			Platform:       "mastodon",
			AccountID:      "masto-1",
			Slug:           "mastodon-old",
			AccessTokenEnc: []byte("token"),
			IsActive:       true,
			CreatedAt:      time.Date(2026, 6, 30, 13, 0, 0, 0, time.UTC),
		},
		{
			ID:             "account-other-workspace",
			WorkspaceID:    "ws-2",
			Platform:       "bluesky",
			AccountID:      "did:plc:abc",
			Slug:           "bsky-personal",
			AccessTokenEnc: []byte("token"),
			IsActive:       true,
			CreatedAt:      time.Date(2026, 6, 30, 14, 0, 0, 0, time.UTC),
		},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", "account-inactive").
		Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	handler := NewMCPHandler(db, testAuthenticator{}, entitlement)
	handler.SetMediaStorage(mediastore.NewLocalStorage(t.TempDir(), "/media"))
	handler.SetPublicURL("https://app.openpost.test")
	handler.RegisterRoutes(e)
	return &mcpTestServer{echo: e, db: db, handler: handler}
}

func insertMCPTestMedia(t *testing.T, srv *mcpTestServer, media models.MediaAttachment) {
	t.Helper()

	if media.WorkspaceID == "" {
		media.WorkspaceID = "ws-1"
	}
	if media.FilePath == "" {
		media.FilePath = media.ID
	}
	if media.MimeType == "" {
		media.MimeType = "image/png"
	}
	if media.ProcessingStatus == "" {
		media.ProcessingStatus = "ready"
	}
	if media.OriginalFilename == "" {
		media.OriginalFilename = media.ID + ".png"
	}
	if media.FileHash == "" {
		media.FileHash = media.ID + "-hash"
	}
	if media.CreatedAt.IsZero() {
		media.CreatedAt = time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC)
	}
	_, err := srv.db.NewInsert().Model(&media).Exec(context.Background())
	require.NoError(t, err)
}

func (s *mcpTestServer) request(t *testing.T, token string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", &payload)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type mcpScopeAuthenticator map[string]middleware.Principal

func (a mcpScopeAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	principal, ok := a[token]
	if !ok {
		return nil, errors.New("invalid token")
	}
	return &principal, nil
}

func TestMCPRejectsMissingAuthorization(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "", map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/list",
	})

	require.Equal(t, http.StatusUnauthorized, resp.Code)
	require.Contains(t, resp.Header().Get("WWW-Authenticate"), `resource_metadata="https://app.openpost.test/.well-known/oauth-protected-resource"`)
	require.Contains(t, resp.Header().Get("WWW-Authenticate"), `scope="mcp:full"`)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	meta := out["_meta"].(map[string]any)
	require.Equal(t, resp.Header().Get("WWW-Authenticate"), meta["mcp/www_authenticate"])
}

func TestMCPGetReturnsMethodNotAllowed(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/mcp", nil)
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)

	require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
	require.Equal(t, http.MethodPost, rec.Header().Get("Allow"))
	require.NotContains(t, rec.Header().Get("Content-Type"), "text/html")
}

func TestMCPProtectedResourceMetadata(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/.well-known/oauth-protected-resource", nil)
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	require.Equal(t, "https://app.openpost.test/mcp", out["resource"])
	require.Equal(t, []any{"https://app.openpost.test"}, out["authorization_servers"])
	require.Equal(t, []any{"mcp:full"}, out["scopes_supported"])
	require.Equal(t, []any{"header"}, out["bearer_methods_supported"])
}

func TestMCPAuthenticatesSupportedTokenScopes(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"web-token":   {UserID: "user-1", Email: "user@example.com"},
		"mcp-token":   {UserID: "user-1", Email: "user@example.com", Scope: "mcp:full"},
		"cli-token":   {UserID: "user-1", Email: "user@example.com", Scope: "cli:full"},
		"media-token": {UserID: "user-1", Email: "user@example.com", Scope: "media:read"},
	}

	for _, token := range []string{"web-token", "mcp-token", "cli-token"} {
		resp := srv.request(t, token, map[string]any{
			"jsonrpc": "2.0",
			"id":      token,
			"method":  "tools/list",
		})
		require.Equal(t, http.StatusOK, resp.Code, token)
	}

	resp := srv.request(t, "media-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "bad-scope",
		"method":  "tools/list",
	})
	require.Equal(t, http.StatusUnauthorized, resp.Code)
	require.Contains(t, resp.Header().Get("WWW-Authenticate"), `scope="mcp:full"`)
}

func TestMCPRejectsAudienceMismatch(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"wrong-audience": {
			UserID:   "user-1",
			Email:    "user@example.com",
			Scope:    "mcp:full",
			Audience: "https://other.openpost.test/mcp",
		},
	}

	resp := srv.request(t, "wrong-audience", map[string]any{
		"jsonrpc": "2.0",
		"id":      "wrong-audience",
		"method":  "tools/list",
	})
	require.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestMCPToolsList(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/list",
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	tools := result["tools"].([]any)
	require.Len(t, tools, 24)
	require.Equal(t, "list_workspaces", tools[0].(map[string]any)["name"])
	require.Equal(t, "list_provider_catalog", tools[1].(map[string]any)["name"])
	require.Equal(t, "list_accounts", tools[2].(map[string]any)["name"])
	require.Equal(t, "list_media", tools[3].(map[string]any)["name"])
	require.Equal(t, "get_provider_readiness", tools[4].(map[string]any)["name"])
	require.Equal(t, "create_publication", tools[5].(map[string]any)["name"])
	require.Equal(t, "list_publications", tools[6].(map[string]any)["name"])
	require.Equal(t, "validate_publication", tools[7].(map[string]any)["name"])
	require.Equal(t, "schedule_publication", tools[8].(map[string]any)["name"])
	require.Equal(t, "publish_publication_now", tools[9].(map[string]any)["name"])
	require.Equal(t, "list_publication_events", tools[10].(map[string]any)["name"])
	require.Equal(t, "list_rendition_comments", tools[11].(map[string]any)["name"])
	require.Equal(t, "create_draft", tools[12].(map[string]any)["name"])
	require.Equal(t, "list_drafts", tools[13].(map[string]any)["name"])
	require.Equal(t, "update_draft", tools[14].(map[string]any)["name"])
	require.Equal(t, "set_post_renditions", tools[15].(map[string]any)["name"])
	require.Equal(t, "schedule_post", tools[16].(map[string]any)["name"])
	require.Equal(t, "schedule_draft", tools[17].(map[string]any)["name"])
	require.Equal(t, "get_post_status", tools[18].(map[string]any)["name"])
	require.Equal(t, "list_scheduled_posts", tools[19].(map[string]any)["name"])
	require.Equal(t, "cancel_post", tools[20].(map[string]any)["name"])
	require.Equal(t, "suggest_next_slot", tools[21].(map[string]any)["name"])
	require.Equal(t, "upload_media_from_url", tools[22].(map[string]any)["name"])
	require.Equal(t, "render_scheduler_widget", tools[23].(map[string]any)["name"])

	requiredOutputKeys := map[string][]any{
		mcpToolWorkspaces:    {"workspaces"},
		mcpToolProviders:     {"providers"},
		mcpToolAccounts:      {"accounts"},
		mcpToolListMedia:     {"media"},
		mcpToolReadiness:     {"providers"},
		mcpToolCreatePub:     {"publication"},
		mcpToolListPubs:      {"publications"},
		mcpToolValidatePub:   {"valid", "issues"},
		mcpToolSchedulePub:   {"publication", "job_id"},
		mcpToolPublishPubNow: {"publication", "job_id"},
		mcpToolPubEvents:     {"events"},
		mcpToolComments:      {"comments"},
		mcpToolCreateDraft:   {"post"},
		mcpToolListDrafts:    {"posts"},
		mcpToolUpdateDraft:   {"post"},
		mcpToolRenditions:    {"post_id", "renditions"},
		mcpToolSchedulePost:  {"post"},
		mcpToolScheduleDraft: {"post"},
		mcpToolGetPost:       {"post"},
		mcpToolListPosts:     {"posts"},
		mcpToolCancelPost:    {"post"},
		mcpToolSuggestSlot:   {"suggestion"},
		mcpToolUploadURL:     {"media"},
		mcpToolRenderWidget:  {"view", "data"},
	}
	for _, tool := range tools {
		descriptor := tool.(map[string]any)
		toolName := descriptor["name"].(string)
		securitySchemes := descriptor["securitySchemes"].([]any)
		require.Len(t, securitySchemes, 1)
		scheme := securitySchemes[0].(map[string]any)
		require.Equal(t, "oauth2", scheme["type"])
		require.Equal(t, []any{"mcp:full"}, scheme["scopes"])
		meta := descriptor["_meta"].(map[string]any)
		require.Equal(t, descriptor["securitySchemes"], meta["securitySchemes"])
		require.NotEmpty(t, meta["openai/toolInvocation/invoking"])
		require.NotEmpty(t, meta["openai/toolInvocation/invoked"])
		require.LessOrEqual(t, len(meta["openai/toolInvocation/invoking"].(string)), 64)
		require.LessOrEqual(t, len(meta["openai/toolInvocation/invoked"].(string)), 64)
		if toolName == mcpToolRenderWidget {
			ui := meta["ui"].(map[string]any)
			require.Equal(t, mcpAppWidgetURI, ui["resourceUri"])
			require.ElementsMatch(t, []any{"model"}, ui["visibility"])
			require.Equal(t, mcpAppWidgetURI, meta["openai/outputTemplate"])
			require.Equal(t, false, meta["openai/widgetAccessible"])
		}
		outputSchema := descriptor["outputSchema"].(map[string]any)
		require.Equal(t, "object", outputSchema["type"])
		require.ElementsMatch(t, requiredOutputKeys[toolName], outputSchema["required"])
		properties := outputSchema["properties"].(map[string]any)
		for _, key := range requiredOutputKeys[toolName] {
			require.Contains(t, properties, key)
		}
	}
	annotations := tools[0].(map[string]any)["annotations"].(map[string]any)
	require.Equal(t, true, annotations["readOnlyHint"])
	require.Equal(t, false, annotations["destructiveHint"])
	require.Equal(t, false, annotations["openWorldHint"])
}

func TestMCPInitializeAdvertisesPrompts(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.SetServerVersion("v9.8.7")
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "init",
		"method":  "initialize",
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	serverInfo := result["serverInfo"].(map[string]any)
	require.Equal(t, "openpost", serverInfo["name"])
	require.Equal(t, "v9.8.7", serverInfo["version"])
	require.Contains(t, result["instructions"], "List workspaces, accounts, providers, and media")
	require.Contains(t, result["instructions"], "render_scheduler_widget")
	capabilities := result["capabilities"].(map[string]any)
	require.Contains(t, capabilities, "tools")
	require.Contains(t, capabilities, "prompts")
	require.Contains(t, capabilities, "resources")
}

func TestMCPResourcesListAndRead(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	listResp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "resources",
		"method":  "resources/list",
	})
	require.Equal(t, http.StatusOK, listResp.Code)
	var listed map[string]any
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &listed))
	resources := listed["result"].(map[string]any)["resources"].([]any)
	require.Len(t, resources, 1)
	resource := resources[0].(map[string]any)
	require.Equal(t, mcpAppWidgetURI, resource["uri"])
	require.Equal(t, mcpAppWidgetMimeType, resource["mimeType"])
	require.Equal(t, "OpenPost Scheduler", resource["title"])

	readResp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "resource",
		"method":  "resources/read",
		"params": map[string]any{
			"uri": mcpAppWidgetURI,
		},
	})
	require.Equal(t, http.StatusOK, readResp.Code)
	var read map[string]any
	require.NoError(t, json.Unmarshal(readResp.Body.Bytes(), &read))
	contents := read["result"].(map[string]any)["contents"].([]any)
	require.Len(t, contents, 1)
	content := contents[0].(map[string]any)
	require.Equal(t, mcpAppWidgetURI, content["uri"])
	require.Equal(t, mcpAppWidgetMimeType, content["mimeType"])
	require.Contains(t, content["text"], "OpenPost Scheduler")
	require.Contains(t, content["text"], "window.openai")
	require.Contains(t, content["text"], "ui/notifications/tool-input")
	require.Contains(t, content["text"], "bridge.toolInput")
	meta := content["_meta"].(map[string]any)
	require.Equal(t, true, meta["openai/widgetPrefersBorder"])
	require.NotEmpty(t, meta["openai/widgetDescription"])
	ui := meta["ui"].(map[string]any)
	require.Equal(t, true, ui["prefersBorder"])
	standardCSP := ui["csp"].(map[string]any)
	require.Contains(t, standardCSP, "connectDomains")
	require.Contains(t, standardCSP, "resourceDomains")
	require.NotContains(t, standardCSP, "connect_domains")
	require.NotContains(t, standardCSP, "resource_domains")
	legacyCSP := meta["openai/widgetCSP"].(map[string]any)
	require.Contains(t, legacyCSP, "connect_domains")
	require.Contains(t, legacyCSP, "resource_domains")
	require.NotContains(t, legacyCSP, "connectDomains")
	require.NotContains(t, legacyCSP, "resourceDomains")
	require.Equal(t, "https://app.openpost.test", meta["openai/widgetDomain"])
	require.Equal(t, "https://app.openpost.test", ui["domain"])
}

func TestMCPResourcesReadRejectsUnknownResource(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "unknown-resource",
		"method":  "resources/read",
		"params": map[string]any{
			"uri": "ui://widget/unknown.html",
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "unknown resource", out["error"].(map[string]any)["message"])
}

func TestMCPAcceptsInitializedNotification(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
	})

	require.Equal(t, http.StatusAccepted, resp.Code)
	require.Empty(t, resp.Body.String())
}

func TestMCPRejectsNonNotificationWithoutID(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"method":  "tools/list",
	})

	require.Equal(t, http.StatusBadRequest, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "notifications must use notifications/* methods", out["error"].(map[string]any)["message"])
}

func TestMCPPing(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "ping-1",
		"method":  "ping",
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "ping-1", out["id"])
	require.Empty(t, out["result"].(map[string]any))
}

func TestMCPPromptsListAndGet(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	listResp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "prompts",
		"method":  "prompts/list",
	})
	require.Equal(t, http.StatusOK, listResp.Code)
	var listed map[string]any
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &listed))
	prompts := listed["result"].(map[string]any)["prompts"].([]any)
	require.Len(t, prompts, 3)
	require.Equal(t, mcpPromptPlanPost, prompts[0].(map[string]any)["name"])
	require.Equal(t, mcpPromptRenditions, prompts[1].(map[string]any)["name"])
	require.Equal(t, mcpPromptReviewQueue, prompts[2].(map[string]any)["name"])

	getResp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "prompt",
		"method":  "prompts/get",
		"params": map[string]any{
			"name": mcpPromptPlanPost,
			"arguments": map[string]string{
				"idea":         "Launch the demo recording",
				"workspace_id": "ws-1",
				"platforms":    "x, linkedin",
			},
		},
	})
	require.Equal(t, http.StatusOK, getResp.Code)
	var got map[string]any
	require.NoError(t, json.Unmarshal(getResp.Body.Bytes(), &got))
	result := got["result"].(map[string]any)
	messages := result["messages"].([]any)
	require.Len(t, messages, 1)
	message := messages[0].(map[string]any)
	require.Equal(t, "user", message["role"])
	text := message["content"].(map[string]any)["text"].(string)
	require.Contains(t, text, "Launch the demo recording")
	require.Contains(t, text, "workspace_id: ws-1")
	require.Contains(t, text, "x, linkedin")
}

func TestMCPPromptsGetRejectsUnknownPrompt(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "bad-prompt",
		"method":  "prompts/get",
		"params": map[string]any{
			"name": "unknown",
		},
	})
	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "unknown prompt", out["error"].(map[string]any)["message"])
}

func TestMCPCallListWorkspaces(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-1",
		"method":  "tools/call",
		"params": map[string]any{
			"name":      "list_workspaces",
			"arguments": map[string]any{},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	require.Contains(t, content[0].(map[string]any)["text"], "Launch")
	structured := result["structuredContent"].(map[string]any)
	workspaces := structured["workspaces"].([]any)
	require.Len(t, workspaces, 2)
	require.Equal(t, "ws-1", workspaces[0].(map[string]any)["id"])
	require.Equal(t, "admin", workspaces[0].(map[string]any)["role"])
}

func TestMCPWorkspaceScopedTokenFiltersAndRejectsOtherWorkspaces(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"scoped-token": {
			UserID:      "user-1",
			Email:       "user@example.com",
			Scope:       "mcp:full",
			WorkspaceID: "ws-1",
			ClientID:    "token-scoped",
			ClientName:  "Scoped MCP",
		},
	}

	listResp := srv.request(t, "scoped-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "scoped-list",
		"method":  "tools/call",
		"params": map[string]any{
			"name":      "list_workspaces",
			"arguments": map[string]any{},
		},
	})
	require.Equal(t, http.StatusOK, listResp.Code)
	var listOut map[string]any
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &listOut))
	workspaces := listOut["result"].(map[string]any)["structuredContent"].(map[string]any)["workspaces"].([]any)
	require.Len(t, workspaces, 1)
	require.Equal(t, "ws-1", workspaces[0].(map[string]any)["id"])

	createResp := srv.request(t, "scoped-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "scoped-create",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "create_draft",
			"arguments": map[string]any{
				"workspace_id": "ws-2",
				"content":      "This should not cross the token boundary",
			},
		},
	})
	require.Equal(t, http.StatusOK, createResp.Code)
	var createOut map[string]any
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &createOut))
	require.Equal(t, "workspace outside token scope", createOut["error"].(map[string]any)["message"])

	count, err := srv.db.NewSelect().
		Model((*models.Post)(nil)).
		Where("workspace_id = ?", "ws-2").
		Where("content = ?", "This should not cross the token boundary").
		Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, count)
}

func TestMCPCallListProviderCatalog(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.SetProviderCatalog(map[string]platform.Adapter{
		"bluesky": providerAvailabilityAdapter{},
		"x":       providerAvailabilityAdapter{},
	}, true)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-providers",
		"method":  "tools/call",
		"params": map[string]any{
			"name":      "list_provider_catalog",
			"arguments": map[string]any{},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	text := content[0].(map[string]any)["text"].(string)
	require.Contains(t, text, "available: Bluesky, X (Twitter), Mastodon")
	require.Contains(t, text, "needs configuration: LinkedIn, Threads, Instagram, Facebook, YouTube, TikTok")
	require.NotContains(t, text, "planned:")

	structured := result["structuredContent"].(map[string]any)
	providers := structured["providers"].([]any)
	require.Len(t, providers, 9)
	byPlatform := map[string]map[string]any{}
	for _, item := range providers {
		provider := item.(map[string]any)
		byPlatform[provider["platform"].(string)] = provider
	}
	require.Equal(t, "available", byPlatform["bluesky"]["status"])
	require.Equal(t, true, byPlatform["bluesky"]["configured"])
	require.Equal(t, "needs_configuration", byPlatform["linkedin"]["status"])
	require.Equal(t, false, byPlatform["linkedin"]["configured"])
	require.Equal(t, "needs_configuration", byPlatform["facebook"]["status"])
	require.Equal(t, false, byPlatform["facebook"]["configured"])
	require.Equal(t, "needs_configuration", byPlatform["instagram"]["status"])
	require.Equal(t, false, byPlatform["instagram"]["configured"])
	require.Equal(t, "needs_configuration", byPlatform["tiktok"]["status"])
	require.Equal(t, false, byPlatform["tiktok"]["configured"])
	require.Equal(t, "needs_configuration", byPlatform["youtube"]["status"])
	require.Equal(t, false, byPlatform["youtube"]["configured"])
	require.Contains(t, byPlatform["youtube"]["capabilities"].([]any), "MCP workflows")
}

func TestMCPCallListPublicationEvents(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID:              "publication-events",
		WorkspaceID:     "ws-1",
		CreatedByID:     "user-1",
		Title:           "Launch",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Launch",
		SourceContent:   "Launch",
		Status:          models.PublicationStatusPublished,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC),
		UpdatedAt:       time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = lifecycle.NewService(srv.db).Record(ctx, lifecycle.EventInput{
		WorkspaceID:   "ws-1",
		PublicationID: "publication-events",
		Type:          lifecycle.EventPublished,
		Status:        lifecycle.StatusSucceeded,
		Message:       "rendition published",
		Metadata:      map[string]any{"provider": "x"},
	})
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-publication-events",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "list_publication_events",
			"arguments": map[string]any{
				"publication_id": "publication-events",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	events := structured["events"].([]any)
	require.Len(t, events, 1)
	event := events[0].(map[string]any)
	require.Equal(t, "published", event["type"])
	require.Equal(t, "succeeded", event["status"])
	require.Equal(t, "rendition published", event["message"])
	require.Equal(t, "x", event["metadata"].(map[string]any)["provider"])
}

func TestMCPCallProviderReadiness(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("granted_scopes = ?", "tweet.read tweet.write offline.access").
		Where("id = ?", "account-1").
		Exec(ctx)
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-provider-readiness",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "get_provider_readiness",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	providers := structured["providers"].([]any)
	require.Len(t, providers, 9)
	byProvider := map[string]map[string]any{}
	for _, provider := range providers {
		item := provider.(map[string]any)
		byProvider[item["provider"].(string)] = item
	}
	require.Equal(t, float64(1), byProvider["x"]["connected_accounts"])
	require.Contains(t, byProvider["x"]["granted_scopes"], "tweet.write")
}

func TestMCPCallValidatePublication(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.SocialAccount{
		ID:             "youtube-account",
		WorkspaceID:    "ws-1",
		Platform:       "youtube",
		AccountID:      "channel-1",
		Slug:           "youtube-channel",
		AccessTokenEnc: []byte("token"),
		GrantedScopes:  "https://www.googleapis.com/auth/youtube",
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Publication{
		ID:              "publication-validate",
		WorkspaceID:     "ws-1",
		CreatedByID:     "user-1",
		Title:           "Launch",
		ContentProfile:  models.ContentProfileLongVideo,
		SourceText:      "Launch",
		SourceContent:   "Launch",
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-validate",
		PublicationID:   "publication-validate",
		SocialAccountID: "youtube-account",
		Platform:        "youtube",
		Profile:         models.ContentProfileLongVideo,
		Body:            "Launch",
		Title:           "Launch video",
		SettingsJSON:    `{"privacy":"private"}`,
		Status:          models.RenditionStatusDraft,
	}).Exec(ctx)
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-validate-publication",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "validate_publication",
			"arguments": map[string]any{
				"publication_id": "publication-validate",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	require.Equal(t, false, structured["valid"])
	issues := structured["issues"].([]any)
	require.NotEmpty(t, issues)
	codes := make([]string, 0, len(issues))
	for _, issue := range issues {
		codes = append(codes, issue.(map[string]any)["code"].(string))
	}
	require.Contains(t, codes, "missing_scope")
}

func TestMCPCallListRenditionComments(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := context.Background()
	encryptor := servicecrypto.NewTokenEncryptor("test-comment-key")
	token, err := encryptor.Encrypt("token")
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("access_token_encrypted = ?", token).
		Where("id = ?", "account-1").
		Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Publication{
		ID:              "publication-comments",
		WorkspaceID:     "ws-1",
		CreatedByID:     "user-1",
		Title:           "Launch",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Launch",
		SourceContent:   "Launch",
		Status:          models.PublicationStatusPublished,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-comments",
		PublicationID:   "publication-comments",
		SocialAccountID: "account-1",
		Platform:        "x",
		Profile:         models.ContentProfileShortText,
		Body:            "Launch",
		SettingsJSON:    "{}",
		Status:          models.RenditionStatusPublished,
		ExternalID:      "external-1",
	}).Exec(ctx)
	require.NoError(t, err)
	srv.handler.SetProviderCatalog(map[string]platform.Adapter{
		"x": fakeCommentAdapter{comments: []platform.Comment{{
			ID:         "comment-1",
			AuthorID:   "author-1",
			AuthorName: "Reader",
			Text:       "Great launch",
			CanReply:   true,
			CanHide:    true,
		}}},
	}, false)
	srv.handler.SetTokenEncryptor(encryptor)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-rendition-comments",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "list_rendition_comments",
			"arguments": map[string]any{
				"rendition_id": "rendition-comments",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	comments := structured["comments"].([]any)
	require.Len(t, comments, 1)
	comment := comments[0].(map[string]any)
	require.Equal(t, "rendition-comments", comment["rendition_id"])
	require.Equal(t, "comment-1", comment["provider_comment_id"])
	require.Equal(t, "Reader", comment["author_name"])
	require.Equal(t, "Great launch", comment["text"])
	require.Equal(t, true, comment["can_reply"])
	require.NotEmpty(t, comment["id"])
}

func TestMCPCallRenderSchedulerWidget(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "render-widget",
		"method":  "tools/call",
		"params": map[string]any{
			"name": mcpToolRenderWidget,
			"arguments": map[string]any{
				"view":         "posts",
				"title":        "Queue review",
				"workspace_id": "ws-1",
				"data": map[string]any{
					"posts": []map[string]any{{
						"id":     "post-1",
						"status": "scheduled",
					}},
				},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	require.Contains(t, content[0].(map[string]any)["text"], "Rendered OpenPost scheduler view")
	structured := result["structuredContent"].(map[string]any)
	require.Equal(t, "posts", structured["view"])
	require.Equal(t, "Queue review", structured["title"])
	require.Equal(t, "ws-1", structured["workspace_id"])
	data := structured["data"].(map[string]any)
	posts := data["posts"].([]any)
	require.Len(t, posts, 1)
	require.Equal(t, "post-1", posts[0].(map[string]any)["id"])
}

func TestMCPCallListAccounts(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-accounts",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "list_accounts",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	require.Contains(t, content[0].(map[string]any)["text"], "x:x-openpost")
	structured := result["structuredContent"].(map[string]any)
	accounts := structured["accounts"].([]any)
	require.Len(t, accounts, 1)
	require.Equal(t, "account-1", accounts[0].(map[string]any)["id"])
	require.Equal(t, "x", accounts[0].(map[string]any)["platform"])
}

func TestMCPCallListMedia(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-old",
		OriginalFilename: "old.png",
		AltText:          "Old launch image",
		Size:             1200,
		CreatedAt:        time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
	})
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-new",
		OriginalFilename: "new.png",
		AltText:          "New launch image",
		Size:             2400,
		Width:            1200,
		Height:           630,
		DurationMS:       12000,
		FrameRate:        29.97,
		AspectRatio:      "40:21",
		DominantType:     "video",
		AnalysisStatus:   "ready",
		PublicURLReady:   true,
		PublicURLCheckedAt: time.Date(
			2026, 6, 30, 16, 5, 0, 0, time.UTC,
		),
		PublicURLStatus: 200,
		ThumbnailsJSON:  `{"sm":"thumb-sm.png"}`,
		IsFavorite:      true,
		CreatedAt:       time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
	})
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-other-workspace",
		WorkspaceID:      "ws-2",
		OriginalFilename: "other.png",
		CreatedAt:        time.Date(2026, 6, 30, 17, 0, 0, 0, time.UTC),
	})
	_, err := srv.db.NewInsert().Model(&models.Post{
		ID:          "post-uses-media",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Uses media",
		Status:      statusDraft,
		CreatedAt:   time.Date(2026, 6, 30, 16, 15, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostMedia{
		PostID:       "post-uses-media",
		MediaID:      "media-new",
		DisplayOrder: 0,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-media",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "list_media",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"limit":        2,
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	require.Contains(t, content[0].(map[string]any)["text"], "Found 2 media items")
	structured := result["structuredContent"].(map[string]any)
	media := structured["media"].([]any)
	require.Len(t, media, 2)
	first := media[0].(map[string]any)
	require.Equal(t, "media-new", first["id"])
	require.Equal(t, "new.png", first["filename"])
	require.Equal(t, "/media/media-new", first["url"])
	require.Equal(t, "/media/media-new/thumb/sm", first["thumbnail_url"])
	require.Equal(t, "New launch image", first["alt_text"])
	require.Equal(t, float64(12000), first["duration_ms"])
	require.Equal(t, float64(29.97), first["frame_rate"])
	require.Equal(t, "40:21", first["aspect_ratio"])
	require.Equal(t, "video", first["dominant_type"])
	require.Equal(t, "ready", first["analysis_status"])
	require.Equal(t, true, first["public_url_ready"])
	require.Equal(t, float64(200), first["public_url_status"])
	require.Equal(t, true, first["is_favorite"])
	require.Equal(t, float64(1), first["usage_count"])
	require.Equal(t, false, first["can_delete"])
	require.Equal(t, "media-old", media[1].(map[string]any)["id"])
}

func TestMCPCallLogsSuccessfulToolCall(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"mcp-token": {
			UserID:      "user-1",
			Email:       "user@example.com",
			Scope:       "mcp:full",
			ClientID:    "token-chatgpt",
			ClientName:  "ChatGPT App",
			TokenPrefix: "abcd1234",
		},
	}
	resp := srv.request(t, "mcp-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-log-success",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "list_accounts",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var call models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&call).Where("tool_name = ?", "list_accounts").Scan(context.Background()))
	require.Equal(t, "user-1", call.UserID)
	require.Equal(t, "ws-1", call.WorkspaceID)
	require.Equal(t, "token-chatgpt", call.ClientID)
	require.Equal(t, "ChatGPT App", call.ClientName)
	require.Equal(t, "mcp:full", call.ClientScope)
	require.Equal(t, "abcd1234", call.ClientTokenPrefix)
	require.Equal(t, "success", call.Status)
	require.Empty(t, call.ErrorMessage)
	require.False(t, call.CreatedAt.IsZero())
}

func TestMCPCallLogsFailedToolCall(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-log-error",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "create_draft",
			"arguments": map[string]any{
				"workspace_id":       "ws-1",
				"content":            "Draft from an agent",
				"social_account_ids": []string{"account-other-workspace"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var call models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&call).Where("tool_name = ?", "create_draft").Scan(context.Background()))
	require.Equal(t, "user-1", call.UserID)
	require.Equal(t, "ws-1", call.WorkspaceID)
	require.Equal(t, "error", call.Status)
	require.Contains(t, call.ErrorMessage, "outside this workspace")
}

func TestMCPCallCreateDraft(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-draft",
		OriginalFilename: "draft.png",
		AltText:          "Draft image",
	})
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-draft",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "create_draft",
			"arguments": map[string]any{
				"workspace_id":       "ws-1",
				"content":            "Draft from an agent",
				"social_account_ids": []string{"account-1"},
				"media_ids":          []string{"media-draft"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	post := structured["post"].(map[string]any)
	require.Equal(t, "draft", post["status"])
	require.Equal(t, "ws-1", post["workspace_id"])
	require.Equal(t, []any{"media-draft"}, post["media_ids"])
	media := post["media"].([]any)
	require.Len(t, media, 1)
	require.Equal(t, "media-draft", media[0].(map[string]any)["media_id"])
	require.Equal(t, "draft.png", media[0].(map[string]any)["original_filename"])
	postID := post["id"].(string)
	require.NotEmpty(t, postID)

	var stored models.Post
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", postID).Scan(context.Background()))
	require.Equal(t, "Draft from an agent", stored.Content)
	require.Equal(t, "user-1", stored.CreatedByID)
	var destinationCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("post_destinations").Where("post_id = ?", postID).Scan(context.Background(), &destinationCount))
	require.Equal(t, 1, destinationCount)
	var postMedia models.PostMedia
	require.NoError(t, srv.db.NewSelect().Model(&postMedia).Where("post_id = ?", postID).Scan(context.Background()))
	require.Equal(t, "media-draft", postMedia.MediaID)
	require.Equal(t, 0, postMedia.DisplayOrder)
}

func TestMCPCallCreateDraftRejectsOutsideAccount(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-draft",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "create_draft",
			"arguments": map[string]any{
				"workspace_id":       "ws-1",
				"content":            "Draft from an agent",
				"social_account_ids": []string{"account-other-workspace"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "outside this workspace")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("posts").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestMCPCallCreateDraftRejectsOutsideMedia(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-other-workspace",
		WorkspaceID:      "ws-2",
		OriginalFilename: "other.png",
	})
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-draft-outside-media",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "create_draft",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"content":      "Draft from an agent",
				"media_ids":    []string{"media-other-workspace"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "outside this workspace")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("posts").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestMCPCallListDraftsReturnsDraftInbox(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	posts := []models.Post{
		{
			ID:          "post-draft-old",
			WorkspaceID: "ws-1",
			CreatedByID: "user-1",
			Content:     "Older draft",
			Status:      statusDraft,
			CreatedAt:   time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
		},
		{
			ID:          "post-draft-new",
			WorkspaceID: "ws-1",
			CreatedByID: "user-1",
			Content:     "Newer draft",
			Status:      statusDraft,
			CreatedAt:   time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
		},
		{
			ID:          "post-draft-scheduled",
			WorkspaceID: "ws-1",
			CreatedByID: "user-1",
			Content:     "Scheduled should not appear",
			Status:      statusScheduled,
			ScheduledAt: time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC),
			CreatedAt:   time.Date(2026, 6, 30, 17, 0, 0, 0, time.UTC),
		},
		{
			ID:          "post-draft-other-workspace",
			WorkspaceID: "ws-2",
			CreatedByID: "user-1",
			Content:     "Other workspace draft",
			Status:      statusDraft,
			CreatedAt:   time.Date(2026, 6, 30, 18, 0, 0, 0, time.UTC),
		},
	}
	_, err := srv.db.NewInsert().Model(&posts).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-draft-list",
		PostID:          "post-draft-new",
		SocialAccountID: "account-1",
		Status:          postStatusPending,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-list-drafts",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "list_drafts",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"limit":        10,
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	require.Contains(t, content[0].(map[string]any)["text"], "Found 2 drafts")
	structured := result["structuredContent"].(map[string]any)
	gotPosts := structured["posts"].([]any)
	require.Len(t, gotPosts, 2)
	first := gotPosts[0].(map[string]any)
	require.Equal(t, "post-draft-new", first["id"])
	require.Equal(t, "Newer draft", first["content"])
	destinations := first["destinations"].([]any)
	require.Len(t, destinations, 1)
	require.Equal(t, "x", destinations[0].(map[string]any)["platform"])
	require.Equal(t, "post-draft-old", gotPosts[1].(map[string]any)["id"])
}

func TestMCPCallUpdateDraftReplacesContentAndDestinations(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	_, err := srv.db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-2",
		WorkspaceID:    "ws-1",
		Platform:       "linkedin",
		AccountID:      "linkedin-1",
		Slug:           "linkedin-openpost",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
		CreatedAt:      time.Date(2026, 6, 30, 14, 30, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	post := models.Post{
		ID:          "post-update-draft",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Old draft",
		Status:      statusDraft,
		CreatedAt:   time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
	}
	_, err = srv.db.NewInsert().Model(&post).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-update-old",
		PostID:          post.ID,
		SocialAccountID: "account-1",
		Status:          postStatusPending,
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostVariant{
		ID:              "variant-update-old",
		PostID:          post.ID,
		SocialAccountID: "account-1",
		Content:         "Old account-specific copy",
		MediaIDs:        "[]",
		IsUnsynced:      true,
		CreatedAt:       time.Date(2026, 6, 30, 15, 5, 0, 0, time.UTC),
		UpdatedAt:       time.Date(2026, 6, 30, 15, 5, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-update-old",
		OriginalFilename: "old-media.png",
	})
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-update-new",
		OriginalFilename: "new-media.png",
	})
	_, err = srv.db.NewInsert().Model(&models.PostMedia{
		PostID:       post.ID,
		MediaID:      "media-update-old",
		DisplayOrder: 0,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-update-draft",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "update_draft",
			"arguments": map[string]any{
				"workspace_id":       "ws-1",
				"post_id":            post.ID,
				"content":            "Sharper agent draft",
				"social_account_ids": []string{"account-2"},
				"media_ids":          []string{"media-update-new"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	gotPost := structured["post"].(map[string]any)
	require.Equal(t, post.ID, gotPost["id"])
	require.Equal(t, "draft", gotPost["status"])
	require.Equal(t, "Sharper agent draft", gotPost["content"])
	destinations := gotPost["destinations"].([]any)
	require.Len(t, destinations, 1)
	require.Equal(t, "account-2", destinations[0].(map[string]any)["social_account_id"])
	require.Equal(t, "linkedin", destinations[0].(map[string]any)["platform"])
	require.Equal(t, []any{"media-update-new"}, gotPost["media_ids"])
	media := gotPost["media"].([]any)
	require.Len(t, media, 1)
	require.Equal(t, "new-media.png", media[0].(map[string]any)["original_filename"])

	var stored models.Post
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", post.ID).Scan(context.Background()))
	require.Equal(t, "Sharper agent draft", stored.Content)
	var oldVariantCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("post_variants").Where("post_id = ?", post.ID).Scan(context.Background(), &oldVariantCount))
	require.Equal(t, 0, oldVariantCount)
	var storedMedia models.PostMedia
	require.NoError(t, srv.db.NewSelect().Model(&storedMedia).Where("post_id = ?", post.ID).Scan(context.Background()))
	require.Equal(t, "media-update-new", storedMedia.MediaID)
}

func TestMCPCallUpdateDraftRejectsScheduledPost(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	post := models.Post{
		ID:          "post-update-scheduled",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Already scheduled",
		Status:      statusScheduled,
		ScheduledAt: time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC),
		CreatedAt:   time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
	}
	_, err := srv.db.NewInsert().Model(&post).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-update-scheduled",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "update_draft",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      post.ID,
				"content":      "This should fail",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "draft")
}

func TestMCPCallSetPostRenditions(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	post := models.Post{
		ID:          "post-renditions",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "One launch thought",
		Status:      statusDraft,
		CreatedAt:   time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
	}
	_, err := srv.db.NewInsert().Model(&post).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-rendition",
		PostID:          post.ID,
		SocialAccountID: "account-1",
		Status:          postStatusPending,
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "media-rendition",
		WorkspaceID:      "ws-1",
		FilePath:         "media-rendition.png",
		MimeType:         "image/png",
		ProcessingStatus: "ready",
		Size:             1234,
		OriginalFilename: "launch.png",
		FileHash:         "media-rendition-hash",
		CreatedAt:        time.Date(2026, 6, 30, 15, 5, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-renditions",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "set_post_renditions",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      post.ID,
				"renditions": []map[string]any{{
					"social_account_id": "account-1",
					"content":           "X-native launch copy with a sharper hook",
					"media_ids":         []string{"media-rendition"},
				}},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	require.Contains(t, content[0].(map[string]any)["text"], "Updated 1 post renditions")
	structured := result["structuredContent"].(map[string]any)
	require.Equal(t, post.ID, structured["post_id"])
	renditions := structured["renditions"].([]any)
	require.Len(t, renditions, 1)
	rendition := renditions[0].(map[string]any)
	require.Equal(t, "account-1", rendition["social_account_id"])
	require.Equal(t, "x", rendition["platform"])
	require.Equal(t, "x-openpost", rendition["slug"])
	require.Equal(t, "X-native launch copy with a sharper hook", rendition["content"])
	require.Equal(t, []any{"media-rendition"}, rendition["media_ids"])
	require.Equal(t, true, rendition["is_unsynced"])

	var stored models.PostVariant
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("post_id = ?", post.ID).Scan(context.Background()))
	require.Equal(t, "account-1", stored.SocialAccountID)
	require.Equal(t, "X-native launch copy with a sharper hook", stored.Content)
	require.Equal(t, `["media-rendition"]`, stored.MediaIDs)
	require.True(t, stored.IsUnsynced)
}

func TestMCPCallSetPostRenditionsRejectsNonDestinationAccount(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	post := models.Post{
		ID:          "post-renditions-no-destination",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "One launch thought",
		Status:      statusDraft,
		CreatedAt:   time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
	}
	_, err := srv.db.NewInsert().Model(&post).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-renditions-invalid",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "set_post_renditions",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      post.ID,
				"renditions": []map[string]any{{
					"social_account_id": "account-1",
					"content":           "This should not be saved",
				}},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "not destinations")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("post_variants").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestMCPCallSchedulePostCreatesPublishJob(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-schedule",
		OriginalFilename: "schedule.png",
		AltText:          "Scheduled image",
	})
	scheduledAt := "2026-07-01T12:00:00Z"
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-schedule",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "schedule_post",
			"arguments": map[string]any{
				"workspace_id":       "ws-1",
				"content":            "Ship agentic scheduling",
				"scheduled_at":       scheduledAt,
				"social_account_ids": []string{"account-1"},
				"media_ids":          []string{"media-schedule"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	post := structured["post"].(map[string]any)
	require.Equal(t, "scheduled", post["status"])
	require.Equal(t, scheduledAt, post["scheduled_at"])
	require.Equal(t, "Ship agentic scheduling", post["content"])
	destinations := post["destinations"].([]any)
	require.Len(t, destinations, 1)
	require.Equal(t, "account-1", destinations[0].(map[string]any)["social_account_id"])
	require.Equal(t, []any{"media-schedule"}, post["media_ids"])
	media := post["media"].([]any)
	require.Len(t, media, 1)
	require.Equal(t, "Scheduled image", media[0].(map[string]any)["alt_text"])
	postID := post["id"].(string)

	var storedPost models.Post
	require.NoError(t, srv.db.NewSelect().Model(&storedPost).Where("id = ?", postID).Scan(context.Background()))
	require.Equal(t, statusScheduled, storedPost.Status)
	require.Equal(t, "user-1", storedPost.CreatedByID)
	require.Equal(t, time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC), storedPost.ScheduledAt)
	require.Equal(t, storedPost.ScheduledAt, storedPost.ActualRunAt)

	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("type = ?", jobTypePublishPost).Scan(context.Background()))
	require.Equal(t, "pending", job.Status)
	require.Equal(t, storedPost.ScheduledAt, job.RunAt)
	var payload map[string]string
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	require.Equal(t, postID, payload[postIDKey])
	var postMedia models.PostMedia
	require.NoError(t, srv.db.NewSelect().Model(&postMedia).Where("post_id = ?", postID).Scan(context.Background()))
	require.Equal(t, "media-schedule", postMedia.MediaID)
}

func TestMCPCallSchedulePostRejectsProviderMediaErrors(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	_, err := srv.db.NewInsert().Model(&models.SocialAccount{
		ID:             "youtube-1",
		WorkspaceID:    "ws-1",
		Platform:       "youtube",
		AccountID:      "yt-1",
		Slug:           "youtube-openpost",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
		CreatedAt:      time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-youtube-image",
		OriginalFilename: "thumbnail.png",
		MimeType:         "image/png",
	})

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-schedule-provider-media",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "schedule_post",
			"arguments": map[string]any{
				"workspace_id":       "ws-1",
				"content":            "This should not schedule",
				"scheduled_at":       "2026-07-01T12:00:00Z",
				"social_account_ids": []string{"youtube-1"},
				"media_ids":          []string{"media-youtube-image"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "YouTube publishing supports video attachments only")
	var jobCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &jobCount))
	require.Equal(t, 0, jobCount)
}

func TestMCPCallGetPostStatusReturnsDestinations(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	scheduledAt := time.Date(2026, 7, 2, 9, 30, 0, 0, time.UTC)
	post := models.Post{
		ID:          "post-status",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Check the launch queue",
		Status:      statusScheduled,
		ScheduledAt: scheduledAt,
		ActualRunAt: scheduledAt,
		CreatedAt:   time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
	}
	_, err := srv.db.NewInsert().Model(&post).Exec(context.Background())
	require.NoError(t, err)
	destination := models.PostDestination{
		ID:              "destination-status",
		PostID:          post.ID,
		SocialAccountID: "account-1",
		Status:          postStatusPending,
	}
	_, err = srv.db.NewInsert().Model(&destination).Exec(context.Background())
	require.NoError(t, err)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-status",
		OriginalFilename: "status.png",
		AltText:          "Status image",
	})
	_, err = srv.db.NewInsert().Model(&models.PostMedia{
		PostID:       post.ID,
		MediaID:      "media-status",
		DisplayOrder: 0,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-status",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "get_post_status",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      post.ID,
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	gotPost := structured["post"].(map[string]any)
	require.Equal(t, post.ID, gotPost["id"])
	require.Equal(t, "scheduled", gotPost["status"])
	require.Equal(t, scheduledAt.Format(time.RFC3339), gotPost["actual_run_at"])
	require.Equal(t, []any{"media-status"}, gotPost["media_ids"])
	media := gotPost["media"].([]any)
	require.Len(t, media, 1)
	require.Equal(t, "status.png", media[0].(map[string]any)["original_filename"])
	destinations := gotPost["destinations"].([]any)
	require.Len(t, destinations, 1)
	require.Equal(t, "x", destinations[0].(map[string]any)["platform"])
	require.Equal(t, "x-openpost", destinations[0].(map[string]any)["slug"])
}

func TestMCPCallListScheduledPostsReturnsQueue(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	posts := []models.Post{
		{
			ID:          "post-list-early",
			WorkspaceID: "ws-1",
			CreatedByID: "user-1",
			Content:     "First queued post",
			Status:      statusScheduled,
			ScheduledAt: time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC),
			ActualRunAt: time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC),
			CreatedAt:   time.Date(2026, 6, 30, 17, 0, 0, 0, time.UTC),
		},
		{
			ID:          "post-list-late",
			WorkspaceID: "ws-1",
			CreatedByID: "user-1",
			Content:     "Second queued post",
			Status:      statusScheduled,
			ScheduledAt: time.Date(2026, 7, 2, 11, 0, 0, 0, time.UTC),
			ActualRunAt: time.Date(2026, 7, 2, 11, 0, 0, 0, time.UTC),
			CreatedAt:   time.Date(2026, 6, 30, 17, 5, 0, 0, time.UTC),
		},
		{
			ID:          "post-list-draft",
			WorkspaceID: "ws-1",
			CreatedByID: "user-1",
			Content:     "Draft should not be listed",
			Status:      statusDraft,
			CreatedAt:   time.Date(2026, 6, 30, 17, 10, 0, 0, time.UTC),
		},
		{
			ID:          "post-list-other-workspace",
			WorkspaceID: "ws-2",
			CreatedByID: "user-1",
			Content:     "Other workspace queued post",
			Status:      statusScheduled,
			ScheduledAt: time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC),
			CreatedAt:   time.Date(2026, 6, 30, 17, 15, 0, 0, time.UTC),
		},
	}
	_, err := srv.db.NewInsert().Model(&posts).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-list",
		PostID:          "post-list-early",
		SocialAccountID: "account-1",
		Status:          postStatusPending,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-list-scheduled",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "list_scheduled_posts",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"from":         "2026-07-01T00:00:00Z",
				"to":           "2026-07-03T00:00:00Z",
				"limit":        10,
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	content := result["content"].([]any)
	require.Contains(t, content[0].(map[string]any)["text"], "Found 2 scheduled posts")
	structured := result["structuredContent"].(map[string]any)
	gotPosts := structured["posts"].([]any)
	require.Len(t, gotPosts, 2)
	first := gotPosts[0].(map[string]any)
	require.Equal(t, "post-list-early", first["id"])
	require.Equal(t, "First queued post", first["content"])
	require.Equal(t, "2026-07-01T09:00:00Z", first["scheduled_at"])
	destinations := first["destinations"].([]any)
	require.Len(t, destinations, 1)
	require.Equal(t, "x", destinations[0].(map[string]any)["platform"])
	require.Equal(t, "post-list-late", gotPosts[1].(map[string]any)["id"])
}

func TestMCPCallCancelPostRemovesQueuedJobAndReturnsDraft(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	postID := "post-cancel"
	scheduledAt := time.Date(2026, 7, 3, 8, 0, 0, 0, time.UTC)
	_, err := srv.db.NewInsert().Model(&models.Post{
		ID:          postID,
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Cancel me",
		Status:      statusScheduled,
		ScheduledAt: scheduledAt,
		ActualRunAt: scheduledAt,
		CreatedAt:   time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	payload, err := json.Marshal(map[string]string{postIDKey: postID})
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Job{
		ID:      "job-cancel",
		Type:    jobTypePublishPost,
		Payload: string(payload),
		Status:  "pending",
		RunAt:   scheduledAt,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-cancel",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "cancel_post",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      postID,
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	post := structured["post"].(map[string]any)
	require.Equal(t, "draft", post["status"])
	require.NotContains(t, post, "scheduled_at")
	require.NotContains(t, post, "actual_run_at")

	var storedPost models.Post
	require.NoError(t, srv.db.NewSelect().Model(&storedPost).Where("id = ?", postID).Scan(context.Background()))
	require.Equal(t, statusDraft, storedPost.Status)
	require.True(t, storedPost.ScheduledAt.IsZero())
	require.True(t, storedPost.ActualRunAt.IsZero())
	var jobCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &jobCount))
	require.Equal(t, 0, jobCount)
}

func TestMCPCallSchedulePostHonorsQuota(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServerWithEntitlement(t, entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitScheduledPostsMonthly: 0,
		},
	}))
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-schedule-quota",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "schedule_post",
			"arguments": map[string]any{
				"workspace_id":       "ws-1",
				"content":            "This should hit the limit",
				"scheduled_at":       "2026-07-01T12:00:00Z",
				"social_account_ids": []string{"account-1"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "scheduled_posts_monthly")
	var postCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("posts").Scan(context.Background(), &postCount))
	require.Equal(t, 0, postCount)
}

func TestMCPCallScheduleDraftQueuesExistingDraft(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	postID := "post-schedule-draft"
	scheduledAt := "2026-07-04T10:30:00Z"
	_, err := srv.db.NewInsert().Model(&models.Post{
		ID:          postID,
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Schedule the existing draft",
		Status:      statusDraft,
		CreatedAt:   time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-schedule-draft",
		PostID:          postID,
		SocialAccountID: "account-1",
		Status:          postStatusPending,
	}).Exec(context.Background())
	require.NoError(t, err)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-schedule-draft-old",
		OriginalFilename: "old-draft.png",
	})
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-schedule-draft-new",
		OriginalFilename: "new-draft.png",
	})
	_, err = srv.db.NewInsert().Model(&models.PostMedia{
		PostID:       postID,
		MediaID:      "media-schedule-draft-old",
		DisplayOrder: 0,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-schedule-draft",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "schedule_draft",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      postID,
				"scheduled_at": scheduledAt,
				"media_ids":    []string{"media-schedule-draft-new"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	post := structured["post"].(map[string]any)
	require.Equal(t, postID, post["id"])
	require.Equal(t, "scheduled", post["status"])
	require.Equal(t, scheduledAt, post["scheduled_at"])
	require.Equal(t, scheduledAt, post["actual_run_at"])
	require.Equal(t, []any{"media-schedule-draft-new"}, post["media_ids"])

	var storedPost models.Post
	require.NoError(t, srv.db.NewSelect().Model(&storedPost).Where("id = ?", postID).Scan(context.Background()))
	require.Equal(t, statusScheduled, storedPost.Status)
	require.Equal(t, time.Date(2026, 7, 4, 10, 30, 0, 0, time.UTC), storedPost.ScheduledAt)

	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("type = ?", jobTypePublishPost).Scan(context.Background()))
	require.Equal(t, "pending", job.Status)
	require.Equal(t, storedPost.ScheduledAt, job.RunAt)
	var payload map[string]string
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	require.Equal(t, postID, payload[postIDKey])
	var storedMedia models.PostMedia
	require.NoError(t, srv.db.NewSelect().Model(&storedMedia).Where("post_id = ?", postID).Scan(context.Background()))
	require.Equal(t, "media-schedule-draft-new", storedMedia.MediaID)
	var postCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("posts").Scan(context.Background(), &postCount))
	require.Equal(t, 1, postCount)
}

func TestMCPCallScheduleDraftRejectsInheritedProviderMediaErrors(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	_, err := srv.db.NewInsert().Model(&models.SocialAccount{
		ID:             "youtube-draft",
		WorkspaceID:    "ws-1",
		Platform:       "youtube",
		AccountID:      "yt-draft",
		Slug:           "youtube-draft",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
		CreatedAt:      time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	postID := "post-youtube-draft"
	_, err = srv.db.NewInsert().Model(&models.Post{
		ID:          postID,
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Draft with incompatible inherited media",
		Status:      statusDraft,
		CreatedAt:   time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{
		ID:              "destination-youtube-draft",
		PostID:          postID,
		SocialAccountID: "youtube-draft",
		Status:          postStatusPending,
	}).Exec(context.Background())
	require.NoError(t, err)
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-youtube-draft-image",
		OriginalFilename: "draft-image.png",
		MimeType:         "image/png",
	})
	_, err = srv.db.NewInsert().Model(&models.PostMedia{
		PostID:       postID,
		MediaID:      "media-youtube-draft-image",
		DisplayOrder: 0,
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-schedule-draft-provider-media",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "schedule_draft",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      postID,
				"scheduled_at": "2026-07-04T10:30:00Z",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "YouTube publishing supports video attachments only")
	var jobCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &jobCount))
	require.Equal(t, 0, jobCount)
}

func TestMCPCallScheduleDraftRejectsMissingDestinations(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	postID := "post-schedule-draft-no-destinations"
	_, err := srv.db.NewInsert().Model(&models.Post{
		ID:          postID,
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Needs an account before scheduling",
		Status:      statusDraft,
		CreatedAt:   time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-schedule-draft-empty",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "schedule_draft",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"post_id":      postID,
				"scheduled_at": "2026-07-04T10:30:00Z",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "destination")
	var jobCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &jobCount))
	require.Equal(t, 0, jobCount)
}

func TestMCPCallSuggestNextSlotReturnsFirstFreeSchedule(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	_, err := srv.db.NewInsert().Model(&[]models.PostingSchedule{
		{
			ID:          "slot-9",
			WorkspaceID: "ws-1",
			UTCHour:     9,
			UTCMinute:   0,
			DayOfWeek:   int(time.Monday),
			Label:       "Morning",
			IsActive:    true,
			CreatedAt:   time.Date(2026, 6, 30, 17, 0, 0, 0, time.UTC),
		},
		{
			ID:          "slot-17",
			WorkspaceID: "ws-1",
			UTCHour:     17,
			UTCMinute:   0,
			DayOfWeek:   int(time.Monday),
			Label:       "Evening",
			IsActive:    true,
			CreatedAt:   time.Date(2026, 6, 30, 17, 5, 0, 0, time.UTC),
		},
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-slot",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "suggest_next_slot",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"after":        "2026-07-06T08:00:00Z",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	suggestion := structured["suggestion"].(map[string]any)
	require.Equal(t, "Next available slot found.", suggestion["message"])
	require.Equal(t, "2026-07-06T09:00:00Z", suggestion["slot_time"])
	require.Equal(t, "2026-07-06T09:00:00Z", suggestion["slot_time_utc"])
	slot := suggestion["slot"].(map[string]any)
	require.Equal(t, "slot-9", slot["id"])
	require.Equal(t, "Morning", slot["label"])
}

func TestMCPCallSuggestNextSlotSkipsOccupiedSlot(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	_, err := srv.db.NewInsert().Model(&[]models.PostingSchedule{
		{
			ID:          "slot-9",
			WorkspaceID: "ws-1",
			UTCHour:     9,
			UTCMinute:   0,
			DayOfWeek:   int(time.Monday),
			Label:       "Morning",
			IsActive:    true,
			CreatedAt:   time.Date(2026, 6, 30, 17, 0, 0, 0, time.UTC),
		},
		{
			ID:          "slot-17",
			WorkspaceID: "ws-1",
			UTCHour:     17,
			UTCMinute:   0,
			DayOfWeek:   int(time.Monday),
			Label:       "Evening",
			IsActive:    true,
			CreatedAt:   time.Date(2026, 6, 30, 17, 5, 0, 0, time.UTC),
		},
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Post{
		ID:          "post-occupied-slot",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Already using the morning slot",
		Status:      statusScheduled,
		ScheduledAt: time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC),
		CreatedAt:   time.Date(2026, 6, 30, 18, 0, 0, 0, time.UTC),
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-slot-occupied",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "suggest_next_slot",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"after":        "2026-07-06T08:00:00Z",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	suggestion := structured["suggestion"].(map[string]any)
	require.Equal(t, "2026-07-06T17:00:00Z", suggestion["slot_time"])
	slot := suggestion["slot"].(map[string]any)
	require.Equal(t, "slot-17", slot["id"])
	require.Equal(t, "Evening", slot["label"])
}

func TestMCPCallUploadMediaFromURLStoresMedia(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.SetMediaURLValidator(func(_ context.Context, remote *url.URL) error {
		require.Equal(t, "https", remote.Scheme)
		require.Equal(t, "cdn.example", remote.Hostname())
		return nil
	})
	srv.handler.SetMediaURLHTTPClient(&http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "https://cdn.example/launch.txt", req.URL.String())
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
			Body:       io.NopCloser(bytes.NewBufferString("launch media")),
			Request:    req,
		}, nil
	})})

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-upload-url",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "upload_media_from_url",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"url":          "https://cdn.example/launch.txt",
				"alt_text":     "Launch text asset",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	structured := result["structuredContent"].(map[string]any)
	media := structured["media"].(map[string]any)
	require.NotEmpty(t, media["id"])
	require.Equal(t, "text/plain; charset=utf-8", media["mime_type"])
	require.Equal(t, "/media/"+media["id"].(string), media["url"])
	require.Equal(t, "launch.txt", media["filename"])
	require.Equal(t, "Launch text asset", media["alt_text"])
	require.Equal(t, "https://cdn.example/launch.txt", media["source_url"])
	require.Equal(t, false, media["deduped"])

	var stored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", media["id"]).Scan(context.Background()))
	require.Equal(t, "ws-1", stored.WorkspaceID)
	require.Equal(t, "launch.txt", stored.OriginalFilename)
	require.Equal(t, "Launch text asset", stored.AltText)
	require.Equal(t, int64(len("launch media")), stored.Size)
}

func TestMCPCallUploadMediaFromURLRejectsLocalhost(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "call-upload-localhost",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "upload_media_from_url",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"url":          "http://127.0.0.1/private.png",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Contains(t, rpcErr["message"], "private or local address")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("media_attachments").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}
