package handlers

import (
	"bytes"
	"context"

	"encoding/json"
	"errors"

	"net/http"
	"net/http/httptest"

	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
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

	allowed := mcpStructuredContent(t, mcpCallOperation(t, srv, "allowed-comment", mcpToolExecute, map[string]any{
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
