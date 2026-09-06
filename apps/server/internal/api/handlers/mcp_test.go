package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
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
	handler.SetMediaStorage(mediastore.NewLocalStorage(t.TempDir(), "/media"))
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
				"operation": mcpToolCreatePub,
				"arguments": map[string]any{
					"workspace_id":    "ws-1",
					"content_profile": "short_text",
					"source_text":     "Draft through execute",
				},
			},
		},
	})

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Nil(t, out["error"])
	publication := out["result"].(map[string]any)["structuredContent"].(map[string]any)["publication"].(map[string]any)
	require.Equal(t, "Draft through execute", publication["source_text"])
	require.Equal(t, "draft", publication["status"])

	var call models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&call).Where("tool_name = ?", mcpToolCreatePub).Scan(t.Context()))
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
			operation:     mcpToolCreatePub,
			arguments:     map[string]any{"workspace_id": "ws-1", "content_profile": "short_text", "source_text": "must not be created"},
			expectedError: "create_publication changes state or performs an external action; call " + mcpToolExecute + " with this operation",
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

	count, err := srv.db.NewSelect().Model((*models.Publication)(nil)).Where("source_text = ?", "must not be created").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)

	var calls []models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&calls).Where("tool_name IN (?)", bun.List([]string{mcpToolCreatePub, mcpToolWorkspaces})).Order("tool_name ASC").Scan(t.Context()))
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
			name: "cached direct operations use the same schema", tool: mcpToolCreatePub,
			arguments: map[string]any{"workspace_id": "ws-1"}, parameter: "content_profile",
		},
		{
			name: "undocumented top-level parameters are rejected", tool: mcpToolCreatePub,
			arguments: map[string]any{
				"workspace_id": "ws-1", "content_profile": "short_text",
				"source_text": "Draft from an agent", "undocumented": true,
			}, parameter: "undocumented",
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

	count, err := srv.db.NewSelect().Model((*models.Publication)(nil)).Where("workspace_id = ?", "ws-1").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "invalid schema inputs must not reach mutation handlers")
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
			"name": "create_publication",
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
		Model((*models.Post)(nil)).
		Where("workspace_id = ?", "ws-2").
		Where("content = ?", "This should not cross the token boundary").
		Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, count)
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
	require.Len(t, events, 2)
	event := events[0].(map[string]any)
	require.Equal(t, "published", event["type"])
	require.Equal(t, "succeeded", event["status"])
	require.Equal(t, "Published to provider", event["summary"])
	require.Equal(t, "x", event["platform"])
	require.NotContains(t, event, "message")
	require.NotContains(t, event, "metadata")
	require.Equal(t, "created", events[1].(map[string]any)["type"])
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

func TestMCPCommentMutationRejectsCredentialBoundToAnotherWorkspace(t *testing.T) {
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

func TestMCPCallAuditLogRecordsSuccessAndFailure(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"mcp-token": {
			UserID: "user-1", Email: "user@example.com", Scope: "mcp:full",
			ClientID: "token-chatgpt", ClientName: "ChatGPT App", TokenPrefix: "abcd1234",
		},
	}
	resp := srv.request(t, "mcp-token", map[string]any{
		"jsonrpc": "2.0", "id": "call-log-success", "method": "tools/call",
		"params": map[string]any{
			"name":      "list_accounts",
			"arguments": map[string]any{"workspace_id": "ws-1"},
		},
	})
	require.Equal(t, http.StatusOK, resp.Code)
	var success models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&success).Where("tool_name = ?", "list_accounts").Scan(context.Background()))
	require.Equal(t, "user-1", success.UserID)
	require.Equal(t, "token-chatgpt", success.ClientID)
	require.Equal(t, "success", success.Status)
	require.Empty(t, success.ErrorMessage)

	failResp := srv.request(t, "mcp-token", map[string]any{
		"jsonrpc": "2.0", "id": "call-log-error", "method": "tools/call",
		"params": map[string]any{
			"name": "create_publication",
			"arguments": map[string]any{
				"workspace_id": "ws-1", "content_profile": "short_text",
				"source_text": "Draft from an agent", "social_account_ids": []string{"account-other-workspace"},
			},
		},
	})
	require.Equal(t, http.StatusOK, failResp.Code)
	var failure models.MCPToolCall
	require.NoError(t, srv.db.NewSelect().Model(&failure).Where("tool_name = ?", "create_publication").Scan(context.Background()))
	require.Equal(t, "error", failure.Status)
	require.Contains(t, failure.ErrorMessage, "outside this workspace")
}
