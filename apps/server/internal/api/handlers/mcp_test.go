package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/providerreadiness"
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
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceActivation)(nil),
		(*models.ProductAnalyticsEvent)(nil),
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
		(*models.ScreenshotTemplateDesign)(nil),
		(*models.ScreenshotTemplateMediaReference)(nil),
		(*models.ScreenshotTemplateRecipeMediaReference)(nil),
		(*models.MediaGenerationRecipe)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignRevision)(nil),
		(*models.DesignRevisionMediaReference)(nil),
		(*models.DesignRevisionMediaIndexState)(nil),
		(*models.VideoProject)(nil),
		(*models.ProjectAsset)(nil),
		(*models.RenditionMediaDelivery)(nil),
		(*models.RenditionMediaDeliveryRelation)(nil),
		(*models.DesignPage)(nil),
		(*models.DesignMediaReference)(nil),
		(*models.DesignTemplate)(nil),
		(*models.DesignTemplateMediaReference)(nil),
		(*models.BrandKit)(nil),
		(*models.ImageEditorEffectPreset)(nil),
		(*models.BrandFont)(nil),
		(*models.MediaCollection)(nil),
		(*models.MediaCollectionItem)(nil),
		(*models.MediaTag)(nil),
		(*models.MediaTagAssignment)(nil),
		(*models.MCPToolCall)(nil),
		(*models.MCPMediaUploadTicket)(nil),
		(*models.ProviderApp)(nil),
		(*models.Publication)(nil),
		(*models.PublicationAsset)(nil),
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
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Agent", CreatedByID: "user-1"}).Exec(ctx)
	require.NoError(t, err)
	workspaces := []models.Workspace{
		{ID: "ws-1", OrganizationID: "organization-1", Name: "Launch", CreatedAt: time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)},
		{ID: "ws-2", OrganizationID: "organization-1", Name: "Personal", CreatedAt: time.Date(2026, 6, 30, 11, 0, 0, 0, time.UTC)},
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
	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	handler.SetMediaStorage(storage)
	mediaHandler := NewMediaHandler(db, storage, nil, testAuthenticator{}, nil)
	mediaHandler.SetEntitlement(entitlement)
	handler.SetMediaHandler(mediaHandler)
	handler.SetPublicURL("https://app.openpost.test")
	handler.SetFeatureGate(alwaysEnabledMCPGate{})
	handler.RegisterRoutes(e)
	return &mcpTestServer{echo: e, db: db, handler: handler}
}

type alwaysEnabledMCPGate struct{}

func (alwaysEnabledMCPGate) IsEffectiveEnabled(context.Context, string, string) (bool, error) {
	return true, nil
}

func (s *mcpTestServer) request(t *testing.T, token string, body any) *httptest.ResponseRecorder {
	return s.requestPath(t, "/mcp", token, body)
}

func (s *mcpTestServer) requestPath(t *testing.T, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestMCPLocalMediaUploadTicketIsHiddenAndOneUse(t *testing.T) {
	t.Parallel()
	for _, state := range []string{"live", "member removed", "session revoked"} {
		t.Run(state, func(t *testing.T) {
			srv := newMCPTestServer(t)
			_, err := srv.db.NewCreateTable().Model((*models.UserSession)(nil)).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.UserSession{ID: "session-1", UserID: "user-1", ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now()}).Exec(t.Context())
			require.NoError(t, err)
			srv.handler.auth = mcpScopeAuthenticator{
				"mcp-token": {UserID: "user-1", Scope: "mcp:full", WorkspaceID: "ws-1", SessionID: "session-1", ClientID: "client-1"},
			}
			png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
			require.NoError(t, err)
			response := srv.request(t, "mcp-token", map[string]any{
				"jsonrpc": "2.0", "id": "ticket", "method": "tools/call",
				"params": map[string]any{"name": mcpToolCreateTicket, "arguments": map[string]any{
					"workspace_id": "ws-1", "filename": "../profile.png", "mime_type": "image/png", "size": len(png), "alt_text": "Profile",
				}},
			})
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var ticketResult struct {
				Result struct {
					Structured map[string]any `json:"structuredContent"`
					Meta       struct {
						Upload struct {
							URL     string            `json:"url"`
							Headers map[string]string `json:"headers"`
						} `json:"upload"`
					} `json:"_meta"`
				} `json:"result"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &ticketResult))
			require.NotContains(t, response.Body.String(), `"structuredContent":{"ticket"`)
			require.Equal(t, "https://app.openpost.test/mcp/media-upload", ticketResult.Result.Meta.Upload.URL)
			authorization := ticketResult.Result.Meta.Upload.Headers["Authorization"]
			require.True(t, strings.HasPrefix(authorization, "Upload "))
			var publicResult struct {
				Result struct {
					Content    json.RawMessage `json:"content"`
					Structured json.RawMessage `json:"structuredContent"`
				} `json:"result"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &publicResult))
			require.NotContains(t, string(publicResult.Result.Content), authorization)
			require.NotContains(t, string(publicResult.Result.Structured), authorization)

			var stored models.MCPMediaUploadTicket
			require.NoError(t, srv.db.NewSelect().Model(&stored).Scan(t.Context()))
			require.Equal(t, "profile.png", stored.Filename)
			require.Equal(t, "session-1", stored.SessionID)
			require.NotContains(t, authorization, stored.TicketHash)

			upload := func() *httptest.ResponseRecorder {
				req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/mcp/media-upload", bytes.NewReader(png))
				req.Header.Set("Authorization", authorization)
				req.Header.Set("Content-Type", "image/png")
				rec := httptest.NewRecorder()
				srv.echo.ServeHTTP(rec, req)
				return rec
			}
			if state == "member removed" {
				_, err := srv.db.NewDelete().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").Exec(t.Context())
				require.NoError(t, err)
			}
			if state == "session revoked" {
				_, err := srv.db.NewUpdate().Model((*models.UserSession)(nil)).Set("revoked_at = ?", time.Now()).Where("id = ?", "session-1").Exec(t.Context())
				require.NoError(t, err)
			}
			first := upload()
			if state != "live" {
				require.True(t, first.Code == http.StatusUnauthorized || first.Code == http.StatusForbidden, first.Body.String())
				return
			}
			require.Equal(t, http.StatusCreated, first.Code, first.Body.String())
			require.Contains(t, first.Body.String(), `"original_filename":"profile.png"`)
			require.Equal(t, http.StatusUnauthorized, upload().Code)
		})
	}
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

func TestMCPRejectsUntrustedBrowserOrigins(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	srv.handler.SetAllowedOrigins([]string{"https://trusted-client.example"})
	srv.handler.auth = mcpScopeAuthenticator{
		"web-token": {UserID: "user-1", SessionID: "session"},
		"mcp-token": {UserID: "user-1", Scope: "mcp:full"},
	}
	for _, tc := range []struct {
		origin, token string
		status        int
	}{
		{"https://attacker.example", "web-token", http.StatusForbidden},
		{"https://trusted-client.example", "web-token", http.StatusUnauthorized},
		{"https://trusted-client.example", "mcp-token", http.StatusOK},
		{"https://app.openpost.test", "web-token", http.StatusOK},
	} {
		t.Run(tc.origin+"/"+tc.token, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+tc.token)
			req.Header.Set("Origin", tc.origin)
			rec := httptest.NewRecorder()
			srv.echo.ServeHTTP(rec, req)
			require.Equal(t, tc.status, rec.Code, rec.Body.String())
		})
	}
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
	// The default direct surface lists query operations themselves: no
	// mutation operations and no discovery trio.
	names := make([]string, 0, len(tools))
	for _, item := range tools {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	require.Contains(t, names, mcpToolWorkspaces)
	require.Contains(t, names, mcpToolRenderWidget)
	require.Contains(t, names, mcpToolRenderUpload)
	require.NotContains(t, names, mcpToolCreateTicket)
	require.NotContains(t, names, mcpToolDeletePub)
	require.NotContains(t, names, mcpToolDeleteMedia)

	rendered := mcpStructuredContent(t, mcpCallOperation(t, srv, "read-token", "read-render", mcpToolRenderUpload, map[string]any{
		"workspace_id": "ws-1",
	}))
	require.Equal(t, "ws-1", rendered["workspace_id"])
	require.NotContains(t, names, mcpToolCreatePub)
	require.NotContains(t, names, mcpToolExecute)
	require.NotContains(t, names, mcpToolSearch)
	require.NotContains(t, names, mcpToolQuery)

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

	for _, toolName := range []string{mcpToolExecute, mcpToolCreatePub} {
		mutationResp := srv.request(t, "read-token", map[string]any{
			"jsonrpc": "2.0",
			"id":      "read-mutation-" + toolName,
			"method":  "tools/call",
			"params": map[string]any{
				"name": toolName,
				"arguments": map[string]any{
					"operation": mcpToolCreatePub,
					"arguments": map[string]any{
						"workspace_id":    "ws-1",
						"content_profile": "short_text",
						"source_text":     "This must not be created",
					},
				},
			},
		})
		var mutationOut map[string]any
		require.NoError(t, json.Unmarshal(mutationResp.Body.Bytes(), &mutationOut))
		require.Contains(t, mutationOut["error"].(map[string]any)["message"], "mcp:read")
	}
}

func TestMCPPublicationExecutionIntentDefaultsAndRequiresInstanceAdmin(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.WithValue(context.Background(), middleware.UserIDKey, "user-1")
	created, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
		"workspace_id": "ws-1", "content_profile": "short_text", "source_text": "Certification test",
		"social_account_ids": []string{"account-1"},
	})
	require.Nil(t, rpcErr)
	publicationID := created.(map[string]any)["structuredContent"].(map[string]any)["publication"].(mcpPublicationStatus).ID

	_, _, intent, rpcErr := srv.handler.loadMCPPublicationAction(ctx, map[string]any{
		"post_id": publicationID, "expected_revision": 1,
	}, "invalid")
	require.Nil(t, rpcErr)
	require.Equal(t, providerreadiness.ExecutionIntentProduction, intent)

	rejectedPublicationID, rejectedRevision, rejectedIntent, rpcErr := srv.handler.loadMCPPublicationAction(ctx, map[string]any{
		"post_id": publicationID, "expected_revision": 1,
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
		"post_id": publicationID, "expected_revision": 1,
		"execution_intent": "certification_test",
	}, "invalid")
	require.Nil(t, rpcErr)
	require.Equal(t, providerreadiness.ExecutionIntentCertificationTest, intent)
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
			"name": "create_post",
			"arguments": map[string]any{
				"workspace_id":    "ws-2",
				"content_profile": "short_text",
				"source_text":     "This should not cross the token boundary",
			},
		},
	})
	require.Equal(t, http.StatusOK, createResp.Code)
	var createOut map[string]any
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &createOut))
	require.Equal(t, "workspace outside token scope", createOut["error"].(map[string]any)["message"])

	count, err := srv.db.NewSelect().
		Model((*models.Publication)(nil)).
		Where("workspace_id = ?", "ws-2").
		Where("source_text = ?", "This should not cross the token boundary").
		Count(context.Background())
	require.NoError(t, err)
	require.EqualValues(t, 0, count)
	jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, jobs)
}

func TestMCPCommentMutationRejectsCredentialBoundToAnotherWorkspace(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.Publication{ID: "publication-comment-boundary", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Launch", ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished, MetadataJSON: "{}", ReleasePlanJSON: "{}"}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{ID: "rendition-comment-boundary", PublicationID: "publication-comment-boundary", SocialAccountID: "account-1", Platform: "x", Profile: models.ContentProfileShortText, Body: "Launch", SettingsJSON: "{}", Status: models.RenditionStatusPublished, ExternalID: "external-1"}).Exec(ctx)
	require.NoError(t, err)
	srv.handler.SetProviderCatalog(map[string]platform.Adapter{"x": fakeCommentAdapter{}}, false)
	commentID, err := encodeCommentReference(commentReference{RenditionID: "rendition-comment-boundary", ProviderCommentID: "provider-comment-1"})
	require.NoError(t, err)

	resp := srv.request(t, "other-workspace-token", map[string]any{"jsonrpc": "2.0", "id": "bound-comment", "method": "tools/call", "params": map[string]any{"name": mcpToolExecute, "arguments": map[string]any{"operation": mcpToolHideComment, "arguments": map[string]any{"comment_id": commentID}}}})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.NotNil(t, out["error"])
	rpcError := out["error"].(map[string]any)
	require.Equal(t, float64(-32602), rpcError["code"])
	require.Equal(t, "workspace outside token scope", rpcError["message"])
	jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobs)

	allowed := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "allowed-comment", mcpToolExecute, map[string]any{
		"operation": mcpToolHideComment,
		"arguments": map[string]any{"comment_id": commentID},
	}))
	jobID, ok := allowed["job_id"].(string)
	require.True(t, ok)
	require.NotEmpty(t, jobID)
	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx))
	require.Equal(t, "engagement_action", job.Type)
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	require.Equal(t, "hide", payload["action"])
	require.Equal(t, "provider-comment-1", payload["provider_comment_id"])
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
	_, err = srv.db.NewInsert().Model(&models.Publication{
		ID:            "publication-occupied-slot",
		WorkspaceID:   "ws-1",
		CreatedByID:   "user-1",
		Title:         "Already using the morning slot",
		SourceText:    "Already using the morning slot",
		SourceContent: "Already using the morning slot",
		Status:        models.PublicationStatusScheduled,
		ScheduledAt:   time.Date(2026, 7, 6, 9, 0, 0, 0, time.UTC),
		CreatedAt:     time.Date(2026, 6, 30, 18, 0, 0, 0, time.UTC),
		UpdatedAt:     time.Date(2026, 6, 30, 18, 0, 0, 0, time.UTC),
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
