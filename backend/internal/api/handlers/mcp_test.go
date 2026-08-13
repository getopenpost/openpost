package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
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
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.ThreadDraft)(nil),
		(*models.Job)(nil),
		(*models.UsageCounter)(nil),
		(*models.PostingSchedule)(nil),
		(*models.MediaAttachment)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignPage)(nil),
		(*models.DesignMediaReference)(nil),
		(*models.DesignTemplate)(nil),
		(*models.DesignTemplateMediaReference)(nil),
		(*models.BrandKit)(nil),
		(*models.BrandFont)(nil),
		(*models.MediaCollection)(nil),
		(*models.MediaCollectionItem)(nil),
		(*models.MediaTag)(nil),
		(*models.MediaTagAssignment)(nil),
		(*models.MCPToolCall)(nil),
		(*models.ProviderApp)(nil),
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil),
		(*models.PublicationLifecycleEvent)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:        "user-1",
		Email:     "agent@example.com",
		CreatedAt: time.Date(2026, 6, 30, 9, 0, 0, 0, time.UTC),
	}).Exec(ctx)
	require.NoError(t, err)
	workspaces := []models.Workspace{
		{ID: "ws-1", Name: "Launch", CreatedAt: time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)},
		{ID: "ws-2", Name: "Personal", CreatedAt: time.Date(2026, 6, 30, 11, 0, 0, 0, time.UTC)},
	}
	_, err = db.NewInsert().Model(&workspaces).Exec(ctx)
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
	ensurePermissiveProviderReadinessFixture(t, db)
	handler.SetProviderReadiness(mcpProviderReadiness(t))
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

func TestMCPRejectsUntrustedBrowserOrigins(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	payload := bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Origin", "https://attacker.example")
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), "Origin")

	srv.handler.SetAllowedOrigins([]string{"https://trusted-client.example"})
	payload = bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	req = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Origin", "https://trusted-client.example")
	rec = httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestMCPEnforcesHTTPContentTypeAndProtocolVersion(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	payload := bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", payload)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnsupportedMediaType, rec.Code)

	payload = bytes.NewBufferString(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	req = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("MCP-Protocol-Version", "2099-01-01")
	rec = httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "MCP-Protocol-Version")

	payload = bytes.NewBufferString(`{"jsonrpc":"2.0","id":3,"method":"tools/list"}`)
	req = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("MCP-Protocol-Version", mcpProtocolVersion)
	rec = httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
}

func TestMCPRejectsOversizedRequestBodies(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		"/mcp",
		strings.NewReader(strings.Repeat(" ", maxMCPRequestBytes+1)),
	)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)

	require.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	require.Contains(t, rec.Body.String(), "exceeds")
}

func TestMCPInitializeNegotiatesSupportedProtocolVersions(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	for _, test := range []struct {
		name      string
		requested string
		expected  string
	}{
		{name: "current", requested: mcpProtocolVersion, expected: mcpProtocolVersion},
		{name: "fallback", requested: mcpFallbackVersion, expected: mcpFallbackVersion},
		{name: "unsupported", requested: "2024-11-05", expected: mcpProtocolVersion},
	} {
		t.Run(test.name, func(t *testing.T) {
			resp := srv.request(t, "web-token", map[string]any{
				"jsonrpc": "2.0", "id": test.name, "method": "initialize",
				"params": map[string]any{
					"protocolVersion": test.requested,
					"capabilities":    map[string]any{},
					"clientInfo":      map[string]any{"name": "test", "version": "1"},
				},
			})
			require.Equal(t, http.StatusOK, resp.Code)
			var out map[string]any
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			require.Equal(t, test.expected, out["result"].(map[string]any)["protocolVersion"])
		})
	}

	resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": "missing", "method": "initialize", "params": map[string]any{}})
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Contains(t, out["error"].(map[string]any)["message"], "protocolVersion")
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
	require.Equal(t, []any{"mcp:read", "mcp:full"}, out["scopes_supported"])
	require.Equal(t, []any{"header"}, out["bearer_methods_supported"])
}

func TestMCPAuthenticatesSupportedTokenScopes(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"web-token":   {UserID: "user-1", Email: "user@example.com"},
		"read-token":  {UserID: "user-1", Email: "user@example.com", Scope: "mcp:read"},
		"mcp-token":   {UserID: "user-1", Email: "user@example.com", Scope: "mcp:full"},
		"cli-token":   {UserID: "user-1", Email: "user@example.com", Scope: "cli:full"},
		"api-read":    {UserID: "user-1", Email: "user@example.com", Scope: "api:read"},
		"api-write":   {UserID: "user-1", Email: "user@example.com", Scope: "api:write"},
		"media-token": {UserID: "user-1", Email: "user@example.com", Scope: "media:read"},
	}

	for _, token := range []string{"web-token", "read-token", "mcp-token", "cli-token"} {
		resp := srv.request(t, token, map[string]any{
			"jsonrpc": "2.0",
			"id":      token,
			"method":  "tools/list",
		})
		require.Equal(t, http.StatusOK, resp.Code, token)
	}

	for _, token := range []string{"api-read", "api-write", "media-token"} {
		resp := srv.request(t, token, map[string]any{
			"jsonrpc": "2.0",
			"id":      "bad-scope-" + token,
			"method":  "tools/list",
		})
		require.Equal(t, http.StatusForbidden, resp.Code, token)
		require.Contains(t, resp.Header().Get("WWW-Authenticate"), `scope="mcp:full"`, token)
		require.Contains(t, resp.Header().Get("WWW-Authenticate"), `error="insufficient_scope"`, token)
	}
}

func TestMCPReadOnlyScopeHidesAndRejectsMutations(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"read-token": {
			UserID:      "user-1",
			Email:       "user@example.com",
			Scope:       "mcp:read",
			WorkspaceID: "ws-1",
			ClientID:    "token-read-only",
			ClientName:  "Read-only MCP",
		},
	}

	toolsResp := srv.request(t, "read-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "read-tools",
		"method":  "tools/list",
	})
	require.Equal(t, http.StatusOK, toolsResp.Code)
	var toolsOut map[string]any
	require.NoError(t, json.Unmarshal(toolsResp.Body.Bytes(), &toolsOut))
	tools := toolsOut["result"].(map[string]any)["tools"].([]any)
	require.Len(t, tools, 3)
	for _, item := range tools {
		require.NotEqual(t, mcpToolExecute, item.(map[string]any)["name"])
	}

	initializeResp := srv.request(t, "read-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "read-initialize",
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "test", "version": "1"},
		},
	})
	var initializeOut map[string]any
	require.NoError(t, json.Unmarshal(initializeResp.Body.Bytes(), &initializeOut))
	require.Contains(t, initializeOut["result"].(map[string]any)["instructions"], "This connection is read-only")

	promptsResp := srv.request(t, "read-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "read-prompts",
		"method":  "prompts/list",
	})
	var promptsOut map[string]any
	require.NoError(t, json.Unmarshal(promptsResp.Body.Bytes(), &promptsOut))
	prompts := promptsOut["result"].(map[string]any)["prompts"].([]any)
	require.Len(t, prompts, 1)
	require.Equal(t, mcpPromptReviewQueue, prompts[0].(map[string]any)["name"])

	searchResp := srv.request(t, "read-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "read-search",
		"method":  "tools/call",
		"params": map[string]any{
			"name":      mcpToolSearch,
			"arguments": map[string]any{"query": "delete a provider comment"},
		},
	})
	var searchOut map[string]any
	require.NoError(t, json.Unmarshal(searchResp.Body.Bytes(), &searchOut))
	operations := searchOut["result"].(map[string]any)["structuredContent"].(map[string]any)["operations"].([]any)
	require.Empty(t, operations)

	queryResp := srv.request(t, "read-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "read-query",
		"method":  "tools/call",
		"params": map[string]any{
			"name": mcpToolQuery,
			"arguments": map[string]any{
				"operation": "list_accounts",
				"arguments": map[string]any{"workspace_id": "ws-1"},
			},
		},
	})
	var queryOut map[string]any
	require.NoError(t, json.Unmarshal(queryResp.Body.Bytes(), &queryOut))
	require.NotContains(t, queryOut, "error")

	for _, toolName := range []string{mcpToolExecute, mcpToolCreateDraft} {
		mutationResp := srv.request(t, "read-token", map[string]any{
			"jsonrpc": "2.0",
			"id":      "read-mutation-" + toolName,
			"method":  "tools/call",
			"params": map[string]any{
				"name": toolName,
				"arguments": map[string]any{
					"operation": mcpToolCreateDraft,
					"arguments": map[string]any{
						"workspace_id": "ws-1",
						"content":      "This must not be created",
					},
				},
			},
		})
		var mutationOut map[string]any
		require.NoError(t, json.Unmarshal(mutationResp.Body.Bytes(), &mutationOut))
		require.Contains(t, mutationOut["error"].(map[string]any)["message"], "mcp:read")
	}
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
	require.Len(t, tools, 4)
	require.Equal(t, mcpToolSearch, tools[0].(map[string]any)["name"])
	require.Equal(t, mcpToolQuery, tools[1].(map[string]any)["name"])
	require.Equal(t, mcpToolExecute, tools[2].(map[string]any)["name"])
	require.Equal(t, mcpToolRenderWidget, tools[3].(map[string]any)["name"])

	requiredOutputKeys := map[string][]any{
		mcpToolSearch:       {"operations"},
		mcpToolQuery:        {},
		mcpToolExecute:      {},
		mcpToolRenderWidget: {"view", "data"},
	}
	expectedSafety := map[string]map[string]any{
		mcpToolSearch:       {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false},
		mcpToolQuery:        {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": true},
		mcpToolExecute:      {"readOnlyHint": false, "destructiveHint": true, "openWorldHint": true},
		mcpToolRenderWidget: {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false},
	}
	for _, tool := range tools {
		descriptor := tool.(map[string]any)
		toolName := descriptor["name"].(string)
		securitySchemes := descriptor["securitySchemes"].([]any)
		require.Len(t, securitySchemes, 1)
		scheme := securitySchemes[0].(map[string]any)
		require.Equal(t, "oauth2", scheme["type"])
		if descriptor["annotations"].(map[string]any)["readOnlyHint"] == true {
			require.Equal(t, []any{"mcp:read", "mcp:full"}, scheme["scopes"])
		} else {
			require.Equal(t, []any{"mcp:full"}, scheme["scopes"])
		}
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
		properties, _ := outputSchema["properties"].(map[string]any)
		for _, key := range requiredOutputKeys[toolName] {
			require.Contains(t, properties, key)
		}
		require.Equal(t, expectedSafety[toolName], descriptor["annotations"])
	}
}

func TestMCPAdvertisedToolCatalogIsCompact(t *testing.T) {
	t.Parallel()

	advertised, err := json.Marshal(mcpAdvertisedTools())
	require.NoError(t, err)
	legacy, err := json.Marshal(mcpOperationCatalog())
	require.NoError(t, err)

	t.Logf("advertised tool descriptors: %d bytes; legacy catalog: %d bytes", len(advertised), len(legacy))
	require.Less(t, len(advertised), len(legacy)*30/100)
}

func TestMCPToolCatalogMeetsAgentUsabilityContract(t *testing.T) {
	t.Parallel()

	descriptors := append([]map[string]any{}, mcpAdvertisedTools()...)
	for _, operation := range mcpOperationCatalog() {
		descriptors = append(descriptors, operation.Descriptor)
	}

	seen := make(map[string]bool, len(descriptors))
	for _, descriptor := range descriptors {
		name, ok := descriptor["name"].(string)
		require.True(t, ok)
		t.Run(name, func(t *testing.T) {
			require.False(t, seen[name], "duplicate MCP tool or operation name")
			seen[name] = true
			require.Regexp(t, `^[a-z0-9]+(?:_[a-z0-9]+)+$`, name, "use descriptive verb_object snake_case names")

			description, ok := descriptor["description"].(string)
			require.True(t, ok)
			require.GreaterOrEqual(t, len(strings.TrimSpace(description)), 30, "description must explain what and when")
			require.Contains(t, strings.ToLower(description), "return", "description must state what the call returns")

			inputSchema, ok := descriptor["inputSchema"].(map[string]any)
			require.True(t, ok)
			assertMCPInputSchemaUsability(t, "arguments", inputSchema)

			outputSchema, ok := descriptor["outputSchema"].(map[string]any)
			require.True(t, ok)
			require.Equal(t, "object", outputSchema["type"])
			require.Contains(t, outputSchema, "properties")
			require.Contains(t, outputSchema, "required")
		})
	}
}

func assertMCPInputSchemaUsability(t *testing.T, path string, schema map[string]any) {
	t.Helper()
	require.Equal(t, "object", schema["type"], "%s must be an object schema", path)
	properties, ok := schema["properties"].(map[string]any)
	require.True(t, ok, "%s must declare properties, even when empty", path)
	require.Contains(t, schema, "required", "%s must declare required, even when empty", path)
	require.Contains(t, schema, "additionalProperties", "%s must state whether extra fields are accepted", path)

	names := make([]string, 0, len(properties))
	for name := range properties {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		propertyPath := path + "." + name
		property, ok := properties[name].(map[string]any)
		require.True(t, ok, "%s must be a JSON Schema object", propertyPath)
		require.NotEmpty(t, strings.TrimSpace(fmt.Sprint(property["description"])), "%s must explain meaning, format, and constraints", propertyPath)
		require.NotEmpty(t, property["type"], "%s must declare a type", propertyPath)

		propertyType, _ := property["type"].(string)
		if propertyType == "object" || propertyType == "array" {
			_, hasExamples := property["examples"]
			description := strings.ToLower(fmt.Sprint(property["description"]))
			require.True(t, hasExamples || strings.Contains(description, "e.g."), "%s must include a concrete example", propertyPath)
		}
		if propertyType == "object" {
			if _, hasProperties := property["properties"]; hasProperties {
				assertMCPInputSchemaUsability(t, propertyPath, property)
			}
		}
		if propertyType == "array" {
			items, ok := property["items"].(map[string]any)
			require.True(t, ok, "%s must type its array items", propertyPath)
			if items["type"] == "object" {
				assertMCPInputSchemaUsability(t, propertyPath+"[]", items)
			}
		}
	}
}

func TestMCPOperationCatalogHasCompleteSafetyClassification(t *testing.T) {
	t.Parallel()

	expectedModes := map[string]mcpOperationMode{
		mcpToolWorkspaces:     mcpOperationQuery,
		mcpToolProviders:      mcpOperationQuery,
		mcpToolAccounts:       mcpOperationQuery,
		mcpToolListMedia:      mcpOperationQuery,
		mcpToolReadiness:      mcpOperationQuery,
		mcpToolCreatePub:      mcpOperationExecute,
		mcpToolListPubs:       mcpOperationQuery,
		mcpToolGetPub:         mcpOperationQuery,
		mcpToolUpdatePub:      mcpOperationExecute,
		mcpToolPubRenditions:  mcpOperationExecute,
		mcpToolReplyRendition: mcpOperationExecute,
		mcpToolValidatePub:    mcpOperationQuery,
		mcpToolSchedulePub:    mcpOperationExecute,
		mcpToolPublishPubNow:  mcpOperationExecute,
		mcpToolPubEvents:      mcpOperationQuery,
		mcpToolComments:       mcpOperationQuery,
		mcpToolReplyComment:   mcpOperationExecute,
		mcpToolHideComment:    mcpOperationExecute,
		mcpToolDeleteComment:  mcpOperationExecute,
		mcpToolCreateDraft:    mcpOperationExecute,
		mcpToolListDrafts:     mcpOperationQuery,
		mcpToolUpdateDraft:    mcpOperationExecute,
		mcpToolRenditions:     mcpOperationExecute,
		mcpToolSchedulePost:   mcpOperationExecute,
		mcpToolScheduleDraft:  mcpOperationExecute,
		mcpToolGetPost:        mcpOperationQuery,
		mcpToolListPosts:      mcpOperationQuery,
		mcpToolCancelPost:     mcpOperationExecute,
		mcpToolSuggestSlot:    mcpOperationQuery,
		mcpToolUploadURL:      mcpOperationExecute,
	}

	catalog := mcpOperationCatalog()
	require.Len(t, catalog, len(expectedModes))
	seen := make(map[string]bool, len(catalog))
	for _, operation := range catalog {
		name, ok := operation.Descriptor["name"].(string)
		require.True(t, ok)
		require.False(t, seen[name], "duplicate operation %s", name)
		seen[name] = true
		require.Equal(t, expectedModes[name], operation.Mode, "unexpected safety classification for %s", name)

		annotations := operation.Descriptor["annotations"].(map[string]any)
		require.Equal(t, operation.Mode == mcpOperationQuery, annotations["readOnlyHint"], "readOnlyHint drifted for %s", name)
		if operation.Mode == mcpOperationQuery {
			require.Equal(t, false, annotations["destructiveHint"], "read-only operation %s cannot be destructive", name)
		}
		require.Equal(t, string(operation.Mode), mcpOperationDocument(operation)["executionTool"])
	}
	require.Equal(t, len(expectedModes), len(seen))
	require.False(t, seen[mcpToolRenderWidget], "the directly advertised renderer must not be delegated")
}

func TestMCPPostCreationSchemasAdvertiseRenditionsOnlyWhereSupported(t *testing.T) {
	t.Parallel()

	propertiesFor := func(name string) map[string]any {
		t.Helper()
		for _, operation := range mcpOperationCatalog() {
			if operation.Descriptor["name"] == name {
				input := operation.Descriptor["inputSchema"].(map[string]any)
				return input["properties"].(map[string]any)
			}
		}
		t.Fatalf("operation %s not found", name)
		return nil
	}

	require.Contains(t, propertiesFor(mcpToolSchedulePost), "renditions")
	require.NotContains(t, propertiesFor(mcpToolCreateDraft), "renditions")
}

func TestMCPPublicationExecutionIntentExistsOnlyOnEnqueueActions(t *testing.T) {
	t.Parallel()

	propertiesFor := func(name string) map[string]any {
		t.Helper()
		for _, operation := range mcpOperationCatalog() {
			if operation.Descriptor["name"] != name {
				continue
			}
			input := operation.Descriptor["inputSchema"].(map[string]any)
			return input["properties"].(map[string]any)
		}
		t.Fatalf("operation %s not found", name)
		return nil
	}

	for _, name := range []string{mcpToolUpdatePub, mcpToolPubRenditions} {
		require.NotContains(t, propertiesFor(name), "execution_intent", name)
	}
	for _, name := range []string{mcpToolSchedulePub, mcpToolPublishPubNow} {
		property, ok := propertiesFor(name)["execution_intent"].(map[string]any)
		require.True(t, ok, name)
		require.Equal(t, []string{"production", "certification_test"}, property["enum"], name)
	}
}

func TestMCPPublicationExecutionIntentDefaultsAndRequiresInstanceAdmin(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := context.WithValue(context.Background(), middleware.UserIDKey, "user-1")
	created, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
		"workspace_id": "ws-1", "content_profile": "short_text", "source_text": "Certification test",
		"social_account_ids": []string{"account-1"},
	})
	require.Nil(t, rpcErr)
	publicationID := created.(map[string]any)["structuredContent"].(map[string]any)["publication"].(mcpPublicationStatus).ID

	_, _, intent, rpcErr := srv.handler.loadMCPPublicationAction(ctx, map[string]any{
		"publication_id": publicationID, "expected_revision": 1,
	}, "invalid")
	require.Nil(t, rpcErr)
	require.Equal(t, providerreadiness.ExecutionIntentProduction, intent)

	rejectedPublicationID, rejectedRevision, rejectedIntent, rpcErr := srv.handler.loadMCPPublicationAction(ctx, map[string]any{
		"publication_id": publicationID, "expected_revision": 1,
		"execution_intent": "certification_test",
	}, "invalid")
	require.NotNil(t, rpcErr)
	require.Empty(t, rejectedPublicationID)
	require.Zero(t, rejectedRevision)
	require.Empty(t, rejectedIntent)
	require.Contains(t, rpcErr.Message, "instance admin role required")

	_, err := srv.db.NewUpdate().Model((*models.User)(nil)).Set("is_admin = ?", true).Where("id = ?", "user-1").Exec(ctx)
	require.NoError(t, err)
	_, _, intent, rpcErr = srv.handler.loadMCPPublicationAction(ctx, map[string]any{
		"publication_id": publicationID, "expected_revision": 1,
		"execution_intent": "certification_test",
	}, "invalid")
	require.Nil(t, rpcErr)
	require.Equal(t, providerreadiness.ExecutionIntentCertificationTest, intent)
}

func TestMCPPublicationLifecycleOperationsStayInParity(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()

	created, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
		"workspace_id": "ws-1", "content_profile": "short_text", "source_text": "Initial copy",
		"social_account_ids": []string{"account-1"},
	})
	require.Nil(t, rpcErr)
	createdContent := created.(map[string]any)["structuredContent"].(map[string]any)
	publicationID := createdContent["publication"].(mcpPublicationStatus).ID

	_, rpcErr = srv.handler.updatePublication(ctx, "user-1", map[string]any{
		"publication_id": publicationID, "expected_revision": 1, "title": "Updated title", "source_text": "Updated copy",
	})
	require.Nil(t, rpcErr)

	_, rpcErr = srv.handler.setPublicationRenditions(ctx, "user-1", map[string]any{
		"publication_id":    publicationID,
		"expected_revision": 2,
		"renditions":        []map[string]any{{"social_account_id": "account-1", "profile": "short_text", "body": "X-native copy"}},
	})
	require.Nil(t, rpcErr)

	loaded, rpcErr := srv.handler.getPublication(ctx, "user-1", map[string]any{"publication_id": publicationID})
	require.Nil(t, rpcErr)
	publication := loaded.(map[string]any)["structuredContent"].(map[string]any)["publication"].(PublicationResponse)
	require.Equal(t, "Updated title", publication.Title)
	require.Equal(t, "Updated copy", publication.SourceText)
	require.NotEmpty(t, publication.TextPostID)
	require.Len(t, publication.Renditions, 1)
	require.Equal(t, "X-native copy", publication.Renditions[0].Body)

	var editor models.Post
	require.NoError(t, srv.db.NewSelect().
		Model(&editor).
		Where("id = ?", publication.TextPostID).
		Scan(ctx))
	require.Equal(t, publicationID, editor.PublicationID)
	require.Equal(t, "Updated copy", editor.Content)
	require.Equal(t, 3, editor.Revision)

	var destination models.PostDestination
	require.NoError(t, srv.db.NewSelect().
		Model(&destination).
		Where("post_id = ? AND social_account_id = ?", editor.ID, "account-1").
		Scan(ctx))
}

func TestMCPPublicationCreationPersistsCreationPresetForEveryMode(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()

	tests := []struct {
		name    string
		profile string
		preset  string
	}{
		{name: "post", profile: models.ContentProfileShortText, preset: models.PublishingIntentPost},
		{name: "thread", profile: models.ContentProfileThread, preset: models.PublishingIntentThread},
		{name: "story", profile: models.ContentProfileStory, preset: models.PublishingIntentStory},
		{name: "short video", profile: models.ContentProfileShortVideo, preset: models.PublishingIntentShortVideo},
		{name: "video", profile: models.ContentProfileLongVideo, preset: models.PublishingIntentVideo},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			created, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
				"workspace_id": "ws-1", "content_profile": test.profile, "source_text": test.name,
			})
			require.Nil(t, rpcErr)
			createdContent := created.(map[string]any)["structuredContent"].(map[string]any)
			publicationID := createdContent["publication"].(mcpPublicationStatus).ID

			var publication models.Publication
			require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx))
			require.Equal(t, test.preset, publication.Intent)
			require.Equal(t, test.preset, publication.CreationPreset)
		})
	}
}

func TestPublicationCreationRESTAndMCPPersistTheSameModesAndCapabilities(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()

	additionalAccounts := []models.SocialAccount{
		{ID: "account-story", WorkspaceID: "ws-1", Platform: "instagram", AccountID: "ig-1", Slug: "instagram-story", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-short-video", WorkspaceID: "ws-1", Platform: "tiktok", AccountID: "tt-1", Slug: "tiktok-video", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-video", WorkspaceID: "ws-1", Platform: "youtube", AccountID: "yt-1", Slug: "youtube-video", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err := srv.db.NewInsert().Model(&additionalAccounts).Exec(ctx)
	require.NoError(t, err)

	restEcho := echo.New()
	api := humaecho.NewWithGroup(restEcho, restEcho.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(srv.db, testAuthenticator{}, nil).RegisterRoutes(api)
	scheduledAt := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)

	tests := []struct {
		name      string
		profile   string
		preset    string
		accountID string
	}{
		{name: "post", profile: models.ContentProfileShortText, preset: models.PublishingIntentPost, accountID: "account-1"},
		{name: "thread", profile: models.ContentProfileThread, preset: models.PublishingIntentThread, accountID: "account-1"},
		{name: "story", profile: models.ContentProfileStory, preset: models.PublishingIntentStory, accountID: "account-story"},
		{name: "short video", profile: models.ContentProfileShortVideo, preset: models.PublishingIntentShortVideo, accountID: "account-short-video"},
		{name: "video", profile: models.ContentProfileLongVideo, preset: models.PublishingIntentVideo, accountID: "account-video"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			restBody, err := json.Marshal(map[string]any{
				"workspace_id": "ws-1", "content_profile": test.profile,
				"title": test.name, "source_text": test.name, "social_account_ids": []string{test.accountID}, "scheduled_at": scheduledAt,
			})
			require.NoError(t, err)
			req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/publications", bytes.NewReader(restBody))
			req.Header.Set("Authorization", "Bearer web-token")
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			restEcho.ServeHTTP(rec, req)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			var restCreated PublicationResponse
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &restCreated))

			mcpCreated, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
				"workspace_id": "ws-1", "content_profile": test.profile,
				"title": test.name, "source_text": test.name, "social_account_ids": []string{test.accountID}, "scheduled_at": scheduledAt,
			})
			require.Nil(t, rpcErr)
			mcpContent := mcpCreated.(map[string]any)["structuredContent"].(map[string]any)
			mcpID := mcpContent["publication"].(mcpPublicationStatus).ID

			var restPublication, mcpPublication models.Publication
			require.NoError(t, srv.db.NewSelect().Model(&restPublication).Where("id = ?", restCreated.ID).Scan(ctx))
			require.NoError(t, srv.db.NewSelect().Model(&mcpPublication).Where("id = ?", mcpID).Scan(ctx))
			require.Equal(t, test.preset, restPublication.Intent)
			require.Equal(t, test.preset, restPublication.CreationPreset)
			require.Equal(t, restPublication.Intent, mcpPublication.Intent)
			require.Equal(t, restPublication.CreationPreset, mcpPublication.CreationPreset)
			require.Equal(t, restPublication.ContentProfile, mcpPublication.ContentProfile)
			require.True(t, restPublication.ScheduledAt.Equal(mcpPublication.ScheduledAt))
			require.Equal(t, models.PublicationStatusDraft, mcpPublication.Status)

			var restRendition, mcpRendition models.Rendition
			require.NoError(t, srv.db.NewSelect().Model(&restRendition).Where("publication_id = ?", restCreated.ID).Scan(ctx))
			require.NoError(t, srv.db.NewSelect().Model(&mcpRendition).Where("publication_id = ?", mcpID).Scan(ctx))
			require.Equal(t, restRendition.Platform, mcpRendition.Platform)
			require.Equal(t, restRendition.Profile, mcpRendition.Profile)
			require.Equal(t, restRendition.OutputProfile, mcpRendition.OutputProfile)
		})
	}

	jobCount, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount, "creating a draft, including one with scheduled_at, must not enqueue it")
}

func TestMCPSearchReturnsRelevantOperationSchemas(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "search",
		"method":  "tools/call",
		"params": map[string]any{
			"name": mcpToolSearch,
			"arguments": map[string]any{
				"query": "schedule_publication",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	operations := result["structuredContent"].(map[string]any)["operations"].([]any)
	require.NotEmpty(t, operations)
	operation := operations[0].(map[string]any)
	require.Equal(t, mcpToolSchedulePub, operation["name"])
	require.Equal(t, mcpToolExecute, operation["executionTool"])
	require.NotNil(t, operation["inputSchema"])
	require.NotNil(t, operation["outputSchema"])
	require.NotNil(t, operation["annotations"])
	require.NotContains(t, operation, "securitySchemes")
	require.NotContains(t, operation, "_meta")
}

func TestMCPSearchRoutesReadOnlyOperationsToQuery(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "search-read",
		"method":  "tools/call",
		"params": map[string]any{
			"name": mcpToolSearch,
			"arguments": map[string]any{
				"query": mcpToolWorkspaces,
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	operations := out["result"].(map[string]any)["structuredContent"].(map[string]any)["operations"].([]any)
	require.NotEmpty(t, operations)
	require.Equal(t, mcpToolWorkspaces, operations[0].(map[string]any)["name"])
	require.Equal(t, mcpToolQuery, operations[0].(map[string]any)["executionTool"])
}

func TestMCPSearchRefusesOutOfScopeAndAmbiguousMutations(t *testing.T) {
	t.Parallel()

	for _, query := range []string{
		"delete a workspace and its database backups",
		"send an email invoice",
		"book a calendar appointment",
		"delete",
	} {
		t.Run(query, func(t *testing.T) {
			result, rpcErr := searchMCPOperations(map[string]any{"query": query})
			require.Nil(t, rpcErr)
			operations := result.(map[string]any)["structuredContent"].(map[string]any)["operations"].([]map[string]any)
			require.Empty(t, operations, "out-of-scope discovery must refuse instead of guessing")
		})
	}

	result, rpcErr := searchMCPOperations(map[string]any{"query": "delete a provider comment"})
	require.Nil(t, rpcErr)
	operations := result.(map[string]any)["structuredContent"].(map[string]any)["operations"].([]map[string]any)
	require.NotEmpty(t, operations)
	require.Equal(t, mcpToolDeleteComment, operations[0]["name"])
}

func TestMCPSearchCommonPhrasesSelectTheIntendedOperation(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		query string
		want  string
	}{
		{query: "list connected accounts", want: mcpToolAccounts},
		{query: "scheduled publication", want: mcpToolSchedulePub},
		{query: "upload media from url", want: mcpToolUploadURL},
		{query: "create a draft post", want: mcpToolCreateDraft},
		{query: "reply to a provider comment", want: mcpToolReplyComment},
	} {
		t.Run(test.query, func(t *testing.T) {
			result, rpcErr := searchMCPOperations(map[string]any{"query": test.query})
			require.Nil(t, rpcErr)
			operations := result.(map[string]any)["structuredContent"].(map[string]any)["operations"].([]map[string]any)
			require.NotEmpty(t, operations)
			require.Equal(t, test.want, operations[0]["name"])
		})
	}
}

func TestMCPQueryDelegatesToDiscoveredReadOnlyOperation(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "query",
		"method":  "tools/call",
		"params": map[string]any{
			"name": mcpToolQuery,
			"arguments": map[string]any{
				"operation": mcpToolWorkspaces,
				"arguments": map[string]any{},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Nil(t, out["error"])
	result := out["result"].(map[string]any)
	workspaces := result["structuredContent"].(map[string]any)["workspaces"].([]any)
	require.Len(t, workspaces, 2)
	require.Equal(t, "ws-1", workspaces[0].(map[string]any)["id"])

	var call models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&call).Where("tool_name = ?", mcpToolWorkspaces).Scan(t.Context()))
	require.Equal(t, mcpToolWorkspaces, call.ToolName)
}

func TestMCPExecuteDelegatesToDiscoveredMutation(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "execute",
		"method":  "tools/call",
		"params": map[string]any{
			"name": mcpToolExecute,
			"arguments": map[string]any{
				"operation": mcpToolCreateDraft,
				"arguments": map[string]any{
					"workspace_id": "ws-1",
					"content":      "Draft through execute",
				},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Nil(t, out["error"])
	post := out["result"].(map[string]any)["structuredContent"].(map[string]any)["post"].(map[string]any)
	require.Equal(t, "Draft through execute", post["content"])
	require.Equal(t, "draft", post["status"])

	var call models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&call).Where("tool_name = ?", mcpToolCreateDraft).Scan(t.Context()))
	require.Equal(t, "success", call.Status)
	require.Equal(t, "ws-1", call.WorkspaceID)
}

func TestMCPDelegatedToolsRejectOperationsAcrossSafetyBoundary(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	tests := []struct {
		name          string
		tool          string
		operation     string
		arguments     map[string]any
		expectedError string
	}{
		{
			name:          "query rejects mutation",
			tool:          mcpToolQuery,
			operation:     mcpToolCreateDraft,
			arguments:     map[string]any{"workspace_id": "ws-1", "content": "must not be created"},
			expectedError: "create_draft changes state or performs an external action; call " + mcpToolExecute + " with this operation",
		},
		{
			name:          "execute rejects read",
			tool:          mcpToolExecute,
			operation:     mcpToolWorkspaces,
			arguments:     map[string]any{},
			expectedError: "list_workspaces is read-only; call " + mcpToolQuery + " with this operation",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resp := srv.request(t, "web-token", map[string]any{
				"jsonrpc": "2.0",
				"id":      test.name,
				"method":  "tools/call",
				"params": map[string]any{
					"name": test.tool,
					"arguments": map[string]any{
						"operation": test.operation,
						"arguments": test.arguments,
					},
				},
			})
			require.Equal(t, http.StatusOK, resp.Code)
			var out map[string]any
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			require.Equal(t, test.expectedError, out["error"].(map[string]any)["message"])
		})
	}

	count, err := srv.db.NewSelect().Model((*models.Post)(nil)).Where("content = ?", "must not be created").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)

	var calls []models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&calls).Where("tool_name IN (?)", bun.List([]string{mcpToolCreateDraft, mcpToolWorkspaces})).Order("tool_name ASC").Scan(t.Context()))
	require.Len(t, calls, 2)
	for _, call := range calls {
		require.Equal(t, "error", call.Status)
		require.NotEmpty(t, call.ErrorMessage)
	}
}

func TestMCPEnforcesAdvertisedAndDiscoveredInputSchemas(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	tests := []struct {
		name      string
		tool      string
		arguments map[string]any
		parameter string
	}{
		{
			name: "delegated arguments are required", tool: mcpToolQuery,
			arguments: map[string]any{"operation": mcpToolWorkspaces}, parameter: "arguments",
		},
		{
			name: "nested parameter types are enforced", tool: mcpToolQuery,
			arguments: map[string]any{
				"operation": mcpToolListMedia,
				"arguments": map[string]any{"workspace_id": "ws-1", "limit": "twenty"},
			},
			parameter: "limit",
		},
		{
			name: "unknown nested parameters are rejected", tool: mcpToolQuery,
			arguments: map[string]any{
				"operation": mcpToolAccounts,
				"arguments": map[string]any{"workspace_id": "ws-1", "invented": true},
			},
			parameter: "invented",
		},
		{
			name: "cached direct operations use the same schema", tool: mcpToolCreateDraft,
			arguments: map[string]any{"workspace_id": "ws-1"}, parameter: "content",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resp := srv.request(t, "web-token", map[string]any{
				"jsonrpc": "2.0", "id": test.name, "method": "tools/call",
				"params": map[string]any{"name": test.tool, "arguments": test.arguments},
			})
			require.Equal(t, http.StatusOK, resp.Code)
			var out map[string]any
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			require.Contains(t, out["error"].(map[string]any)["message"], test.parameter)
		})
	}

	count, err := srv.db.NewSelect().Model((*models.Post)(nil)).Where("workspace_id = ?", "ws-1").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "invalid schema inputs must not reach mutation handlers")
}

func TestMCPLegacyDiscoveryAliasesRemainCallableButUnadvertised(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	for legacy, canonical := range map[string]string{
		mcpLegacyToolSearch:  mcpToolSearch,
		mcpLegacyToolQuery:   mcpToolQuery,
		mcpLegacyToolExecute: mcpToolExecute,
	} {
		arguments := map[string]any{}
		switch canonical {
		case mcpToolSearch:
			arguments = map[string]any{"query": mcpToolWorkspaces}
		case mcpToolQuery:
			arguments = map[string]any{"operation": mcpToolWorkspaces, "arguments": map[string]any{}}
		case mcpToolExecute:
			arguments = map[string]any{"operation": mcpToolCreateDraft, "arguments": map[string]any{"workspace_id": "ws-1", "content": "Legacy alias draft"}}
		}
		resp := srv.request(t, "web-token", map[string]any{
			"jsonrpc": "2.0", "id": legacy, "method": "tools/call",
			"params": map[string]any{"name": legacy, "arguments": arguments},
		})
		require.Equal(t, http.StatusOK, resp.Code, legacy)
		var out map[string]any
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
		require.Nil(t, out["error"], legacy)
	}

	for _, descriptor := range mcpAdvertisedTools() {
		name := descriptor["name"].(string)
		require.NotContains(t, []string{mcpLegacyToolSearch, mcpLegacyToolQuery, mcpLegacyToolExecute}, name)
	}
}

func TestMCPValidatesStructuredOutputAgainstAdvertisedSchema(t *testing.T) {
	t.Parallel()

	valid := map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "No workspaces available."}},
		"structuredContent": map[string]any{"workspaces": []mcpWorkspace{}},
	}
	require.Nil(t, validateMCPToolOutput(mcpToolWorkspaces, valid))

	invalid := map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Invalid"}},
		"structuredContent": map[string]any{"workspaces": "not-an-array"},
	}
	rpcErr := validateMCPToolOutput(mcpToolWorkspaces, invalid)
	require.NotNil(t, rpcErr)
	require.Contains(t, rpcErr.Message, "workspaces")
}

func TestMCPInitializeAdvertisesPrompts(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.SetServerVersion("v9.8.7")
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "init",
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "openpost-test", "version": "1.0.0"},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	result := out["result"].(map[string]any)
	serverInfo := result["serverInfo"].(map[string]any)
	require.Equal(t, "openpost", serverInfo["name"])
	require.Equal(t, "v9.8.7", serverInfo["version"])
	require.Contains(t, result["instructions"], "Call "+mcpToolSearch)
	require.Contains(t, result["instructions"], "Call "+mcpToolQuery)
	require.Contains(t, result["instructions"], mcpToolExecute+" only")
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

func TestMCPViewerCannotCreateDraft(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	_, err := srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").
		Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "viewer-create",
		"method":  "tools/call",
		"params": map[string]any{
			"name": mcpToolCreateDraft,
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"content":      "Viewer draft",
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "workspace editor role required", out["error"].(map[string]any)["message"])
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
	require.Contains(t, text, "needs configuration: Discord, LinkedIn, Threads, Instagram, Facebook, YouTube, TikTok")
	require.NotContains(t, text, "planned:")

	structured := result["structuredContent"].(map[string]any)
	providers := structured["providers"].([]any)
	require.Len(t, providers, 10)
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
	require.Equal(t, "Published to provider", event["summary"])
	require.Equal(t, "x", event["platform"])
	require.NotContains(t, event, "message")
	require.NotContains(t, event, "metadata")
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
	require.Len(t, providers, 10)
	byProvider := map[string]map[string]any{}
	for _, provider := range providers {
		item := provider.(map[string]any)
		byProvider[item["provider"].(string)] = item
	}
	require.Equal(t, float64(1), byProvider["x"]["connected_accounts"])
	require.NotContains(t, byProvider["x"], "granted_scopes")
	require.NotContains(t, byProvider["x"], "public_media_health")
	require.NotEmpty(t, byProvider["x"]["profiles"])
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

func TestMCPCommentMutationQueuesOneAttemptProviderJob(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-comment-action", WorkspaceID: "ws-1", CreatedByID: "user-1",
		Title: "Launch", ContentProfile: models.ContentProfileShortText,
		SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		MetadataJSON: "{}", ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-comment-action", PublicationID: "publication-comment-action",
		SocialAccountID: "account-1", Platform: "x", Profile: models.ContentProfileShortText,
		Body: "Launch", SettingsJSON: "{}", Status: models.RenditionStatusPublished,
		ExternalID: "external-1",
	}).Exec(ctx)
	require.NoError(t, err)
	srv.handler.SetProviderCatalog(map[string]platform.Adapter{"x": fakeCommentAdapter{}}, false)
	commentID, err := encodeCommentReference(commentReference{
		RenditionID: "rendition-comment-action", ProviderCommentID: "provider-comment-1",
	})
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0", "id": "queue-comment-reply", "method": "tools/call",
		"params": map[string]any{
			"name": mcpToolExecute,
			"arguments": map[string]any{
				"operation": mcpToolReplyComment,
				"arguments": map[string]any{"comment_id": commentID, "body": "Thanks"},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Nil(t, out["error"])
	structured := out["result"].(map[string]any)["structuredContent"].(map[string]any)
	require.Equal(t, "comment reply queued", structured["message"])
	jobID := structured["id"].(string)
	require.NotEmpty(t, jobID)
	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx))
	require.Equal(t, "engagement_action", job.Type)
	require.Equal(t, 1, job.MaxAttempts)
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	require.Equal(t, "reply", payload["action"])
	require.Equal(t, "provider-comment-1", payload["provider_comment_id"])
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

func TestMCPRequiredSSOTokenBinding(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := context.Background()
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.APIToken)(nil),
	} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	for _, model := range []any{
		&models.Organization{ID: "mcp-organization", Name: "MCP organization", CreatedByID: "user-1"},
		&models.IdentityProvider{
			ID:             "mcp-provider",
			OrganizationID: "mcp-organization",
			Issuer:         "https://idp.mcp.example.test",
			Name:           "MCP SSO",
			ClientID:       "mcp-client",
			IsActive:       true,
		},
		&models.OrganizationSSOPolicy{
			OrganizationID:          "mcp-organization",
			Mode:                    models.OrganizationSSOModeRequired,
			ProviderIDs:             `["mcp-provider"]`,
			AssuranceMaxAgeSeconds:  int((12 * time.Hour).Seconds()),
			APITokenMode:            models.OrganizationSSOTokensScoped,
			MaxTokenLifetimeSeconds: int((30 * 24 * time.Hour).Seconds()),
		},
		&models.APIToken{
			ID:          "mcp-unbound-token-id",
			UserID:      "user-1",
			Name:        "Unbound MCP",
			TokenHash:   "mcp-unbound-hash",
			TokenPrefix: "unbound",
			Scope:       "mcp:full",
			ExpiresAt:   now.Add(24 * time.Hour),
		},
		&models.APIToken{
			ID:                 "mcp-bound-token-id",
			UserID:             "user-1",
			Name:               "Bound MCP",
			TokenHash:          "mcp-bound-hash",
			TokenPrefix:        "bound",
			Scope:              "mcp:full",
			WorkspaceID:        "ws-1",
			OrganizationID:     "mcp-organization",
			IdentityProviderID: "mcp-provider",
			AssuredAt:          now,
			ExpiresAt:          now.Add(24 * time.Hour),
		},
	} {
		_, err := srv.db.NewInsert().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
	_, err := srv.db.NewUpdate().
		Model((*models.Workspace)(nil)).
		Set("organization_id = ?", "mcp-organization").
		Where("id = ?", "ws-1").
		Exec(ctx)
	require.NoError(t, err)

	srv.handler.auth = mcpScopeAuthenticator{
		"bound-mcp-token": {
			UserID: "user-1", Email: "user@example.com", Scope: "mcp:full",
			WorkspaceID: "ws-1", TokenID: "mcp-bound-token-id",
		},
		"unbound-mcp-token": {
			UserID: "user-1", Email: "user@example.com", Scope: "mcp:full",
			TokenID: "mcp-unbound-token-id",
		},
	}
	request := func(token, toolName string, arguments map[string]any) map[string]any {
		resp := srv.request(t, token, map[string]any{
			"jsonrpc": "2.0",
			"id":      token,
			"method":  "tools/call",
			"params": map[string]any{
				"name":      toolName,
				"arguments": arguments,
			},
		})
		require.Equal(t, http.StatusOK, resp.Code)
		var out map[string]any
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
		return out
	}

	bound := request("bound-mcp-token", "list_accounts", map[string]any{"workspace_id": "ws-1"})
	require.NotContains(t, bound, "error")
	unbound := request("unbound-mcp-token", "list_accounts", map[string]any{"workspace_id": "ws-1"})
	require.Contains(t, unbound["error"].(map[string]any)["message"], "workspace not accessible")

	boundWorkspaces := request("bound-mcp-token", "list_workspaces", map[string]any{})
	require.NotContains(t, boundWorkspaces, "error")
	boundRows := boundWorkspaces["result"].(map[string]any)["structuredContent"].(map[string]any)["workspaces"].([]any)
	require.Len(t, boundRows, 1)
	require.Equal(t, "ws-1", boundRows[0].(map[string]any)["id"])
	unboundWorkspaces := request("unbound-mcp-token", "list_workspaces", map[string]any{})
	require.NotContains(t, unboundWorkspaces, "error")
	unboundRows := unboundWorkspaces["result"].(map[string]any)["structuredContent"].(map[string]any)["workspaces"].([]any)
	require.Len(t, unboundRows, 1)
	require.Equal(t, "ws-2", unboundRows[0].(map[string]any)["id"])
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

func TestMCPRejectsUndocumentedToolArguments(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "unknown-argument",
		"method":  "tools/call",
		"params": map[string]any{
			"name": "create_draft",
			"arguments": map[string]any{
				"workspace_id": "ws-1",
				"content":      "Draft from an agent",
				"undocumented": true,
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "invalid create_draft arguments: undocumented: unexpected property", out["error"].(map[string]any)["message"])
	count, err := srv.db.NewSelect().Model((*models.Post)(nil)).Where("content = ?", "Draft from an agent").Count(context.Background())
	require.NoError(t, err)
	require.Zero(t, count)
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
	require.Equal(t, float64(1), post["revision"])
	require.NotEmpty(t, post["publication_id"])
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
	require.Equal(t, 1, stored.Revision)
	require.NotEmpty(t, stored.PublicationID)
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
				"expected_revision":  1,
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
	require.Equal(t, float64(2), gotPost["revision"])
	require.NotEmpty(t, gotPost["publication_id"])
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
	require.Equal(t, 2, stored.Revision)
	require.NotEmpty(t, stored.PublicationID)
	var publication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", stored.PublicationID).Scan(context.Background()))
	require.Equal(t, 2, publication.Revision)
	var oldVariantCount int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("post_variants").Where("post_id = ?", post.ID).Scan(context.Background(), &oldVariantCount))
	require.Equal(t, 0, oldVariantCount)
	var storedMedia models.PostMedia
	require.NoError(t, srv.db.NewSelect().Model(&storedMedia).Where("post_id = ?", post.ID).Scan(context.Background()))
	require.Equal(t, "media-update-new", storedMedia.MediaID)
}

func TestMCPCallUpdateDraftRejectsStaleRevisionWithoutMutation(t *testing.T) {
	srv := newMCPTestServer(t)
	post := models.Post{
		ID:          "post-update-conflict",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "Original",
		Status:      statusDraft,
		Revision:    1,
		CreatedAt:   time.Date(2026, 6, 30, 15, 0, 0, 0, time.UTC),
	}
	_, err := srv.db.NewInsert().Model(&post).Exec(context.Background())
	require.NoError(t, err)

	call := func(content string) map[string]any {
		resp := srv.request(t, "web-token", map[string]any{
			"jsonrpc": "2.0",
			"id":      content,
			"method":  "tools/call",
			"params": map[string]any{
				"name": "update_draft",
				"arguments": map[string]any{
					"workspace_id":      "ws-1",
					"post_id":           post.ID,
					"expected_revision": 1,
					"content":           content,
				},
			},
		})
		var out map[string]any
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
		return out
	}

	require.NotContains(t, call("First save"), "error")
	stale := call("Stale overwrite")
	require.Contains(t, stale["error"].(map[string]any)["message"], "changed after")

	var stored models.Post
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", post.ID).Scan(context.Background()))
	require.Equal(t, "First save", stored.Content)
	require.Equal(t, 2, stored.Revision)
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
				"workspace_id":      "ws-1",
				"post_id":           post.ID,
				"expected_revision": 1,
				"content":           "This should fail",
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
				"workspace_id":      "ws-1",
				"post_id":           post.ID,
				"expected_revision": 1,
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
				"workspace_id":      "ws-1",
				"post_id":           post.ID,
				"expected_revision": 1,
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

func TestMCPCallSetPostRenditionsRejectsInvalidScheduledOutputWithoutMutation(t *testing.T) {
	srv := newMCPTestServer(t)
	post := models.Post{ID: "scheduled-rendition-invalid", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "source", Status: models.PostStatusScheduled, ScheduledAt: time.Now().Add(time.Hour), CreatedAt: time.Now()}
	_, err := srv.db.NewInsert().Model(&post).Exec(context.Background())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostDestination{ID: "scheduled-rendition-invalid-destination", PostID: post.ID, SocialAccountID: "account-1", Status: postStatusPending}).Exec(context.Background())
	require.NoError(t, err)
	existing := models.PostVariant{ID: "scheduled-rendition-existing", PostID: post.ID, SocialAccountID: "account-1", Content: "valid existing copy", MediaIDs: "", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	_, err = srv.db.NewInsert().Model(&existing).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": "invalid-scheduled-rendition", "method": "tools/call", "params": map[string]any{"name": "set_post_renditions", "arguments": map[string]any{
		"workspace_id": "ws-1", "post_id": post.ID, "expected_revision": 1, "renditions": []map[string]any{{"social_account_id": "account-1", "content": strings.Repeat("x", 281)}},
	}}})
	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	rpcErr := out["error"].(map[string]any)
	require.Equal(t, float64(-32602), rpcErr["code"])
	require.Contains(t, rpcErr["message"], "invalid scheduled rendition")

	var stored models.PostVariant
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", existing.ID).Scan(context.Background()))
	require.Equal(t, existing.Content, stored.Content)
	require.Equal(t, existing.MediaIDs, stored.MediaIDs)
}

func TestMCPCallSetPostRenditionsAcceptsValidScheduledMediaModes(t *testing.T) {
	for _, tc := range []struct {
		name    string
		media   any
		wantRaw string
	}{
		{name: "inherit", wantRaw: ""},
		{name: "override", media: []string{"override-media"}, wantRaw: `["override-media"]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newMCPTestServer(t)
			insertMCPTestMedia(t, srv, models.MediaAttachment{ID: "source-media"})
			insertMCPTestMedia(t, srv, models.MediaAttachment{ID: "override-media"})
			post := models.Post{ID: "scheduled-rendition-" + tc.name, WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "source", Status: models.PostStatusScheduled, ScheduledAt: time.Now().Add(time.Hour), CreatedAt: time.Now()}
			_, err := srv.db.NewInsert().Model(&post).Exec(context.Background())
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.PostDestination{ID: post.ID + "-destination", PostID: post.ID, SocialAccountID: "account-1", Status: postStatusPending}).Exec(context.Background())
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.PostMedia{PostID: post.ID, MediaID: "source-media"}).Exec(context.Background())
			require.NoError(t, err)
			rendition := map[string]any{"social_account_id": "account-1", "content": "valid destination copy"}
			if tc.media != nil {
				rendition["media_ids"] = tc.media
			}
			resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": tc.name, "method": "tools/call", "params": map[string]any{"name": "set_post_renditions", "arguments": map[string]any{
				"workspace_id": "ws-1", "post_id": post.ID, "expected_revision": 1, "renditions": []map[string]any{rendition},
			}}})
			var out map[string]any
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			require.NotContains(t, out, "error")
			var stored models.PostVariant
			require.NoError(t, srv.db.NewSelect().Model(&stored).Where("post_id = ?", post.ID).Scan(context.Background()))
			require.Equal(t, tc.wantRaw, stored.MediaIDs)
		})
	}
}

func TestDecodeVariantMediaStateRejectsNull(t *testing.T) {
	_, _, err := decodeVariantMediaState("null")
	require.ErrorContains(t, err, "JSON array")
}

func TestMCPCallSchedulePostCreatesPublishJob(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"mcp-token": {
			UserID: "user-1", Email: "user@example.com", Scope: "mcp:full",
			TokenID: "token-mcp-schedule", ClientID: "mcp-client", ClientName: "Assistant",
		},
	}
	insertMCPTestMedia(t, srv, models.MediaAttachment{
		ID:               "media-schedule",
		OriginalFilename: "schedule.png",
		AltText:          "Scheduled image",
	})
	insertMCPTestMedia(t, srv, models.MediaAttachment{ID: "media-rendition", OriginalFilename: "x.png"})
	scheduledAt := "2026-07-01T12:00:00Z"
	resp := srv.request(t, "mcp-token", map[string]any{
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
				"renditions":         []map[string]any{{"social_account_id": "account-1", "content": strings.Repeat("x", 280), "media_ids": []string{"media-rendition"}}},
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
	renditions := post["renditions"].([]any)
	require.Len(t, renditions, 1)
	require.Equal(t, []any{"media-rendition"}, renditions[0].(map[string]any)["media_ids"])
	require.Equal(t, "override", renditions[0].(map[string]any)["media_mode"])
	require.Equal(t, []any{"media-rendition"}, renditions[0].(map[string]any)["effective_media_ids"])
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
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("type = ?", jobTypePublishPublication).Scan(context.Background()))
	require.Equal(t, "pending", job.Status)
	require.Equal(t, storedPost.PublicationID, job.ScopeID)
	require.Equal(t, storedPost.ScheduledAt, job.RunAt)
	var payload map[string]string
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	require.Equal(t, storedPost.PublicationID, payload["publication_id"])
	var receipt models.PublicationAuthorization
	require.NoError(t, srv.db.NewSelect().Model(&receipt).Where("job_id = ?", job.ID).Scan(context.Background()))
	require.Equal(t, publicationauth.OriginMCP, receipt.ActorOrigin)
	require.Equal(t, "token-mcp-schedule", receipt.ActorTokenID)
	require.Equal(t, "mcp-client", receipt.ActorClientID)
	var postMedia models.PostMedia
	require.NoError(t, srv.db.NewSelect().Model(&postMedia).Where("post_id = ?", postID).Scan(context.Background()))
	require.Equal(t, "media-schedule", postMedia.MediaID)
}

func TestMCPCallSchedulePostRenditionMediaModes(t *testing.T) {
	tests := []struct {
		name          string
		media         any
		wantRaw       string
		wantMode      string
		wantEffective []any
	}{
		{name: "inherit", wantRaw: "", wantMode: "inherit", wantEffective: []any{"source-media"}},
		{name: "clear", media: []string{}, wantRaw: "[]", wantMode: "clear", wantEffective: []any{}},
		{name: "override", media: []string{"override-media"}, wantRaw: `["override-media"]`, wantMode: "override", wantEffective: []any{"override-media"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newMCPTestServer(t)
			insertMCPTestMedia(t, srv, models.MediaAttachment{ID: "source-media", MimeType: "image/png"})
			insertMCPTestMedia(t, srv, models.MediaAttachment{ID: "override-media", MimeType: "image/png"})
			rendition := map[string]any{"social_account_id": "account-1", "content": "destination copy"}
			if tt.media != nil {
				rendition["media_ids"] = tt.media
			}
			resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": "modes", "method": "tools/call", "params": map[string]any{"name": "schedule_post", "arguments": map[string]any{
				"workspace_id": "ws-1", "content": "source", "scheduled_at": "2026-07-01T12:00:00Z", "social_account_ids": []string{"account-1"}, "media_ids": []string{"source-media"}, "renditions": []map[string]any{rendition},
			}}})
			var out map[string]any
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			require.NotContains(t, out, "error")
			got := out["result"].(map[string]any)["structuredContent"].(map[string]any)["post"].(map[string]any)["renditions"].([]any)[0].(map[string]any)
			require.Equal(t, tt.wantMode, got["media_mode"])
			require.Equal(t, tt.wantEffective, got["effective_media_ids"])
			var stored models.PostVariant
			require.NoError(t, srv.db.NewSelect().Model(&stored).Scan(context.Background()))
			require.Equal(t, tt.wantRaw, stored.MediaIDs)
		})
	}
}

func TestMCPCallSchedulePostValidatesDestinationEffectiveMedia(t *testing.T) {
	for _, tc := range []struct {
		name             string
		source, override string
		wantError        bool
	}{
		{name: "rejects incompatible rendition", source: "video", override: "image", wantError: true},
		{name: "accepts valid override despite invalid source", source: "image", override: "video"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newMCPTestServer(t)
			_, err := srv.db.NewInsert().Model(&models.SocialAccount{ID: "youtube-effective", WorkspaceID: "ws-1", Platform: "youtube", AccountID: "yt", Slug: "yt", AccessTokenEnc: []byte("token"), IsActive: true, CreatedAt: time.Now()}).Exec(context.Background())
			require.NoError(t, err)
			insertMCPTestMedia(t, srv, models.MediaAttachment{ID: "image", MimeType: "image/png"})
			insertMCPTestMedia(t, srv, models.MediaAttachment{ID: "video", MimeType: "video/mp4"})
			resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": "effective", "method": "tools/call", "params": map[string]any{"name": "schedule_post", "arguments": map[string]any{
				"workspace_id": "ws-1", "content": "source", "scheduled_at": "2026-07-01T12:00:00Z", "social_account_ids": []string{"youtube-effective"}, "media_ids": []string{tc.source}, "renditions": []map[string]any{{"social_account_id": "youtube-effective", "content": "youtube", "media_ids": []string{tc.override}}},
			}}})
			var out map[string]any
			require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
			if tc.wantError {
				require.Contains(t, out["error"].(map[string]any)["message"], "video attachments only")
			} else {
				require.NotContains(t, out, "error")
			}
		})
	}
}

func TestMCPCallSchedulePostRejectsOverLimitXRenditionBeforeEnqueue(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": "over-limit", "method": "tools/call", "params": map[string]any{"name": "schedule_post", "arguments": map[string]any{
		"workspace_id": "ws-1", "content": "shared", "scheduled_at": "2026-07-01T12:00:00Z", "social_account_ids": []string{"account-1"},
		"renditions": []map[string]any{{"social_account_id": "account-1", "content": strings.Repeat("x", 281)}},
	}}})
	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Contains(t, out["error"].(map[string]any)["message"], "280 character limit")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Scan(context.Background(), &count))
	require.Zero(t, count)
}

func TestMCPCallSchedulePostValidatesInstagramAndTikTokCaptionBoundariesBeforeEnqueue(t *testing.T) {
	for _, provider := range []string{"instagram", "tiktok"} {
		for _, delta := range []int{0, 1} {
			name := fmt.Sprintf("%s/%d", provider, delta)
			t.Run(name, func(t *testing.T) {
				srv := newMCPTestServer(t)
				accountID := provider + "-caption"
				_, err := srv.db.NewInsert().Model(&models.SocialAccount{ID: accountID, WorkspaceID: "ws-1", Platform: provider, AccountID: accountID, Slug: accountID, AccessTokenEnc: []byte("token"), IsActive: true, CreatedAt: time.Now()}).Exec(context.Background())
				require.NoError(t, err)
				mediaID := provider + "-caption-video"
				insertMCPTestMedia(t, srv, models.MediaAttachment{ID: mediaID, MimeType: "video/mp4"})

				resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": name, "method": "tools/call", "params": map[string]any{"name": "schedule_post", "arguments": map[string]any{
					"workspace_id": "ws-1", "content": "source", "scheduled_at": "2026-07-01T12:00:00Z", "social_account_ids": []string{accountID}, "media_ids": []string{mediaID},
					"renditions": []map[string]any{{"social_account_id": accountID, "content": strings.Repeat("x", 2200+delta)}},
				}}})
				var out map[string]any
				require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
				jobCount, err := srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Count(context.Background())
				require.NoError(t, err)
				if delta == 0 {
					require.NotContains(t, out, "error")
					require.Equal(t, 1, jobCount)
				} else {
					require.Contains(t, out["error"].(map[string]any)["message"], "2200 character limit")
					require.Zero(t, jobCount)
				}
			})
		}
	}
}

func TestMCPCallSetPostRenditionsValidatesInstagramAndTikTokCaptionBoundariesBeforeUpdate(t *testing.T) {
	for _, provider := range []string{"instagram", "tiktok"} {
		t.Run(provider, func(t *testing.T) {
			srv := newMCPTestServer(t)
			accountID := provider + "-update-caption"
			_, err := srv.db.NewInsert().Model(&models.SocialAccount{ID: accountID, WorkspaceID: "ws-1", Platform: provider, AccountID: accountID, Slug: accountID, AccessTokenEnc: []byte("token"), IsActive: true, CreatedAt: time.Now()}).Exec(context.Background())
			require.NoError(t, err)
			mediaID := provider + "-update-video"
			insertMCPTestMedia(t, srv, models.MediaAttachment{ID: mediaID, MimeType: "video/mp4"})
			post := models.Post{ID: provider + "-scheduled-update", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "source", Status: models.PostStatusScheduled, ScheduledAt: time.Now().Add(time.Hour), CreatedAt: time.Now()}
			_, err = srv.db.NewInsert().Model(&post).Exec(context.Background())
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.PostDestination{ID: post.ID + "-destination", PostID: post.ID, SocialAccountID: accountID, Status: postStatusPending}).Exec(context.Background())
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.PostMedia{PostID: post.ID, MediaID: mediaID}).Exec(context.Background())
			require.NoError(t, err)

			call := func(content string, expectedRevision int) map[string]any {
				resp := srv.request(t, "web-token", map[string]any{"jsonrpc": "2.0", "id": provider, "method": "tools/call", "params": map[string]any{"name": "set_post_renditions", "arguments": map[string]any{
					"workspace_id": "ws-1", "post_id": post.ID, "expected_revision": expectedRevision, "renditions": []map[string]any{{"social_account_id": accountID, "content": content}},
				}}})
				var out map[string]any
				require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
				return out
			}

			require.NotContains(t, call(strings.Repeat("x", 2200), 1), "error")
			over := call(strings.Repeat("y", 2201), 2)
			require.Contains(t, over["error"].(map[string]any)["message"], "2200 character limit")
			var stored models.PostVariant
			require.NoError(t, srv.db.NewSelect().Model(&stored).Where("post_id = ?", post.ID).Scan(context.Background()))
			require.Equal(t, strings.Repeat("x", 2200), stored.Content)
		})
	}
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
	_, err = srv.db.NewInsert().Model(&models.PostVariant{ID: "variant-status", PostID: post.ID, SocialAccountID: "account-1", Content: "X status", MediaIDs: "", IsUnsynced: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Exec(context.Background())
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
	rendition := gotPost["renditions"].([]any)[0].(map[string]any)
	require.Equal(t, "inherit", rendition["media_mode"])
	require.Equal(t, []any{"media-status"}, rendition["effective_media_ids"])
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
	_, err = srv.db.NewInsert().Model(&models.PostVariant{ID: "variant-list", PostID: "post-list-early", SocialAccountID: "account-1", Content: "clear media", MediaIDs: "[]", IsUnsynced: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Exec(context.Background())
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
	listRendition := first["renditions"].([]any)[0].(map[string]any)
	require.Equal(t, "clear", listRendition["media_mode"])
	require.Equal(t, []any{}, listRendition["effective_media_ids"])
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
		ScopeID: postID,
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
				"workspace_id":      "ws-1",
				"post_id":           postID,
				"expected_revision": 1,
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
				"workspace_id":      "ws-1",
				"post_id":           postID,
				"expected_revision": 1,
				"scheduled_at":      scheduledAt,
				"media_ids":         []string{"media-schedule-draft-new"},
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
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("type = ?", jobTypePublishPublication).Scan(context.Background()))
	require.Equal(t, "pending", job.Status)
	require.Equal(t, storedPost.ScheduledAt, job.RunAt)
	var payload map[string]string
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	require.Equal(t, storedPost.PublicationID, payload["publication_id"])
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
				"workspace_id":      "ws-1",
				"post_id":           postID,
				"expected_revision": 1,
				"scheduled_at":      "2026-07-04T10:30:00Z",
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
				"workspace_id":      "ws-1",
				"post_id":           postID,
				"expected_revision": 1,
				"scheduled_at":      "2026-07-04T10:30:00Z",
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
