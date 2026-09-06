package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type publicationAuthorizationAuthenticator map[string]*middleware.Principal

func (a publicationAuthorizationAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	if principal := a[token]; principal != nil {
		copy := *principal
		return &copy, nil
	}
	return nil, apitokens.ErrInvalidToken
}

func TestRESTPublicationAuthorizationCapturesBrowserAPIAndCLIActors(t *testing.T) {
	tests := []struct {
		name, token, userAgent, expectedOrigin string
		principal                              *middleware.Principal
	}{
		{name: "browser", token: "browser-token", expectedOrigin: publicationauth.OriginBrowser,
			principal: &middleware.Principal{UserID: "user-1", SessionID: "session-1"}},
		{name: "api", token: "api-token", expectedOrigin: publicationauth.OriginAPI,
			principal: &middleware.Principal{UserID: "user-1", TokenID: "token-api", ClientID: "integration-1", ClientName: "Automation", Scope: apitokens.ScopeCLI}},
		{name: "cli", token: "cli-token", userAgent: "openpost-cli/3.5.0", expectedOrigin: publicationauth.OriginCLI,
			principal: &middleware.Principal{UserID: "user-1", TokenID: "token-cli", ClientID: openPostCLIClientID, ClientName: "Laptop", Scope: apitokens.ScopeCLI}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := newPublicationAuthorizationHandlerDB(t)
			seedPublicationAuthorizationHandlerFixture(t, db)
			e := echo.New()
			api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			handler := newReadyPublicationHandler(t, db, publicationAuthorizationAuthenticator{test.token: test.principal})
			handler.RegisterRoutes(api)
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost,
				"/api/v1/publications/publication-1/publish-now", bytes.NewBufferString(`{"expected_revision":1}`))
			req.Header.Set("Authorization", "Bearer "+test.token)
			req.Header.Set("Content-Type", "application/json")
			if test.userAgent != "" {
				req.Header.Set("User-Agent", test.userAgent)
			}
			response := httptest.NewRecorder()
			e.ServeHTTP(response, req)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())

			var receipt models.PublicationAuthorization
			require.NoError(t, db.NewSelect().Model(&receipt).Scan(t.Context()))
			require.Equal(t, test.expectedOrigin, receipt.ActorOrigin)
			require.Equal(t, test.principal.UserID, receipt.ActorUserID)
			require.Equal(t, test.principal.SessionID, receipt.ActorSessionID)
			require.Equal(t, test.principal.TokenID, receipt.ActorTokenID)
			require.Equal(t, test.principal.ClientID, receipt.ActorClientID)
			require.Equal(t, test.principal.ClientName, receipt.ActorClientName)
		})
	}
}

func TestMCPPublicationAuthorizationRetainsTokenAndClientIdentity(t *testing.T) {
	db := newPublicationAuthorizationHandlerDB(t)
	seedPublicationAuthorizationHandlerFixture(t, db)
	_, err := db.NewUpdate().Model((*models.Publication)(nil)).
		Set("scheduled_at = ?", time.Now().UTC().Add(time.Hour)).Where("id = ?", "publication-1").Exec(t.Context())
	require.NoError(t, err)
	principal := &middleware.Principal{
		UserID: "user-1", Scope: apitokens.ScopeMCP, TokenID: "token-mcp",
		ClientID: "https://assistant.example/client.json", ClientName: "Assistant",
	}
	raw, err := json.Marshal(map[string]any{
		"name":      mcpToolSchedulePub,
		"arguments": map[string]any{"publication_id": "publication-1", "expected_revision": 1},
	})
	require.NoError(t, err)
	handler := &MCPHandler{db: db}
	ensurePermissiveProviderReadinessFixture(t, db)
	handler.SetProviderReadiness(permissiveProviderReadiness(t))
	result, rpcErr := handler.callTool(t.Context(), principal, raw)
	require.Nil(t, rpcErr)
	require.NotNil(t, result)

	var receipt models.PublicationAuthorization
	require.NoError(t, db.NewSelect().Model(&receipt).Scan(t.Context()))
	require.Equal(t, publicationauth.OriginMCP, receipt.ActorOrigin)
	require.Equal(t, principal.TokenID, receipt.ActorTokenID)
	require.Equal(t, principal.ClientID, receipt.ActorClientID)
	require.Equal(t, principal.ClientName, receipt.ActorClientName)
}

func TestAccountExportRedactsPublicationAuthorizationSecretsAndFingerprints(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Publication)(nil), (*models.APIToken)(nil))
	now := time.Now().UTC()
	receipt := &models.PublicationAuthorization{
		ID: "authorization-1", BatchID: "batch-1", JobID: "job-secret",
		WorkspaceID: "workspace-1", PublicationID: "publication-1", RenditionID: "rendition-1",
		Action: publicationauth.ActionPublish, ActorOrigin: publicationauth.OriginAPI,
		ActorUserID: "user-1", ActorSessionID: "session-secret", ActorTokenID: "token-secret",
		ActorClientID: "client-1", ActorClientName: "Automation",
		PublicationRevision: 3, SocialAccountID: "account-1", TargetKey: "x",
		ScheduledAt: now, ContentHash: "sha256:content-secret", MediaHash: "sha256:media-secret",
		SettingsHash: "sha256:settings-secret", PolicyMode: publicationauth.PolicyScheduled,
		ConfirmedAt: now, CreatedAt: now,
	}
	_, err := db.NewInsert().Model(receipt).Exec(t.Context())
	require.NoError(t, err)
	exported := AccountExport{
		Publications: []AccountExportPublication{}, Posts: []AccountExportPost{},
		APITokens: []AccountExportToken{}, PublicationAuthorizations: []AccountExportPublicationAuthorization{},
	}
	require.NoError(t, (&AccountLifecycleHandler{db: db}).loadExportUserContent(t.Context(), "user-1", &exported))
	require.Len(t, exported.PublicationAuthorizations, 1)
	require.True(t, exported.PublicationAuthorizations[0].SessionIdentityStored)
	require.True(t, exported.PublicationAuthorizations[0].TokenIdentityStored)
	require.True(t, exported.PublicationAuthorizations[0].FingerprintsRecorded)
	encoded, err := json.Marshal(exported)
	require.NoError(t, err)
	for _, secret := range []string{
		"session-secret", "token-secret", "job-secret",
		"sha256:content-secret", "sha256:media-secret", "sha256:settings-secret",
	} {
		require.NotContains(t, string(encoded), secret)
	}
}

func newPublicationAuthorizationHandlerDB(t *testing.T) *bun.DB {
	t.Helper()
	return createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil), (*models.Publication)(nil), (*models.Job)(nil),
		(*models.MCPToolCall)(nil),
	)
}

func seedPublicationAuthorizationHandlerFixture(t *testing.T, db *bun.DB) {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-1", "x")
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Authorized", ContentProfile: models.ContentProfileShortText,
		SourceText: "Authorized body", SourceContent: "Authorized body",
		Status: models.PublicationStatusDraft, Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	seedHandlerRendition(t, db, "rendition-1", "publication-1", "account-1", "x", "Authorized body", models.RenditionStatusReady)
}
