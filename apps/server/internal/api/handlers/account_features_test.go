package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Fakes for accountfeatures provider support

type fakeMessagingProvider struct {
	platform.Adapter
	support platform.MessagingSupport
}

func (f fakeMessagingProvider) MessagingSupport() platform.MessagingSupport { return f.support }
func (fakeMessagingProvider) FetchMessages(_ context.Context, _ string, _ platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	return platform.FetchMessagesResult{}, nil
}
func (fakeMessagingProvider) SendMessage(_ context.Context, _ string, _ platform.SendMessageRequest) (platform.SendMessageResult, error) {
	return platform.SendMessageResult{}, nil
}

type accountFeaturesTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	service *accountfeatures.Service
}

func newAccountFeaturesTestServer(t *testing.T, providers map[string]platform.Adapter) *accountFeaturesTestServer {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.AccountFeature)(nil),
		(*models.User)(nil),
		(*models.Job)(nil),
		(*models.AnalyticsSyncState)(nil),
		(*models.EngagementSyncState)(nil),
		(*models.MessagingSyncState)(nil),
		(*models.GrowthSyncState)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "W1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-2", OrganizationID: "org-1", Name: "W2"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-2", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)

	if providers == nil {
		providers = map[string]platform.Adapter{}
	}
	svc := accountfeatures.NewService(db, providers, nil)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAccountFeaturesHandler(svc, testAuthenticator{})
	handler.ReadFeatures(api)
	handler.SaveFeatures(api)

	// Also wire OAuth shim server for legacy tests
	oauthHandler := &OAuthHandler{db: db, auth: testAuthenticator{}}
	oauthHandler.SetAccountFeaturesService(svc)
	// need providers for oauth handler as well
	oauthHandler.providers = providers
	oauthHandler.accountFeatures = svc
	oauthHandler.ListAccounts(api)
	oauthHandler.UpdateAccount(api)

	return &accountFeaturesTestServer{echo: e, db: db, service: svc}
}

func (s *accountFeaturesTestServer) request(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func seedAccount(t *testing.T, db *bun.DB, id, workspaceID string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: id, WorkspaceID: workspaceID, Slug: id, Platform: "x", AccountID: "remote-" + id,
		AccessTokenEnc: []byte("tok"), IsActive: true,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func TestDevNullEngagementCanBeEnabledWithoutReconnect(t *testing.T) {
	t.Parallel()
	srv := newAccountFeaturesTestServer(t, map[string]platform.Adapter{"devnull": platform.NewDevNullAdapter("")})
	seedAccount(t, srv.db, "devnull-account", "ws-1")
	_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("platform = ?", "devnull").Where("id = ?", "devnull-account").Exec(t.Context())
	require.NoError(t, err)
	resp := srv.request(t, http.MethodGet, "/api/v1/account-features?workspace_id=ws-1&account_ids=devnull-account", nil)
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var features []FeatureStateResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &features))
	for _, feature := range features {
		if feature.Feature == "engagement" {
			require.True(t, feature.Supported)
			require.Equal(t, "available", feature.Availability)
			require.Empty(t, feature.MissingScopes)
		}
	}
	resp = srv.request(t, http.MethodPost, "/api/v1/account-features", map[string]any{
		"workspace_id": "ws-1",
		"choices":      []map[string]any{{"account_id": "devnull-account", "feature": "engagement", "enabled": true}},
	})
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &features))
	var enabled bool
	for _, feature := range features {
		if feature.Feature == "engagement" {
			enabled = feature.EffectiveEnabled
		}
	}
	require.True(t, enabled, "existing SSH connections must allow enabling comments and replies")
}

func TestAccountFeaturesAuthViewerAndCrossWorkspace(t *testing.T) {
	t.Parallel()
	providers := map[string]platform.Adapter{
		"x": fakeMessagingProvider{support: platform.MessagingSupport{Enabled: true}},
	}
	// Create server where user-1 is viewer in ws-1
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.AccountFeature)(nil),
		(*models.User)(nil),
	)
	ctx := t.Context()
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "W1"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleViewer, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-2", OrganizationID: "org-1", Name: "W2"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-2", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	svc := accountfeatures.NewService(db, providers, nil)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAccountFeaturesHandler(svc, testAuthenticator{})
	handler.ReadFeatures(api)
	handler.SaveFeatures(api)
	// Also need OAuth shim for cross-workspace later? Not needed
	seedAccount(t, db, "acc-1", "ws-1")
	seedAccount(t, db, "acc-cross", "ws-2")

	// Viewer can read (ws-1 viewer)
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/account-features?workspace_id=ws-1&account_ids=acc-1", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	// Viewer cannot write (needs edit)
	req = httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/account-features", bytes.NewBufferString(`{"workspace_id":"ws-1","choices":[{"account_id":"acc-1","feature":"messaging","enabled":true}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusForbidden, rec.Code)

	// Cross-workspace rejection: account belongs to ws-2 but workspace_id ws-1, using editor server for ws-2? Use original srv for cross check with editor
	srv2 := newAccountFeaturesTestServer(t, providers)
	seedAccount(t, srv2.db, "acc-cross2", "ws-2")
	req = httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/account-features?workspace_id=ws-1&account_ids=acc-cross2", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec = httptest.NewRecorder()
	srv2.echo.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNotFound, rec.Code)
}
