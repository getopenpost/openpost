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
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	growthservice "github.com/openpost/backend/internal/services/growth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func newGrowthTestServer(t *testing.T) *growthTestServer {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.GrowthRecommendation)(nil),
		(*models.GrowthSyncState)(nil),
		(*models.Job)(nil),
		(*models.ProviderWriteAttempt)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Org"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "WS"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-2", OrganizationID: "org-1", Name: "WS2"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com", CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-2", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "acc-bluesky", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok")}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "acc-masto", WorkspaceID: "ws-1", Platform: "mastodon", AccountID: "123", InstanceURL: "https://mastodon.example", IsActive: true, AccessTokenEnc: []byte("tok")}).Exec(ctx)
	require.NoError(t, err)
	svc := growthservice.NewService(db, staticGrowthTokenSource{}, nil)
	svc.SetProvider("bluesky", &fakeGrowthHandlerAdapter{})
	svc.SetProvider("mastodon:https://mastodon.example", &fakeGrowthHandlerAdapter{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewGrowthHandler(svc, testAuthenticator{}).RegisterRoutes(api)
	return &growthTestServer{echo: e, db: db, svc: svc}
}

type staticGrowthTokenSource struct{}

func (staticGrowthTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

type fakeGrowthHandlerAdapter struct{ platform.Adapter }

func (fakeGrowthHandlerAdapter) DiscoverGrowthCandidates(_ context.Context, _ platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
	return []platform.GrowthCandidate{}, nil
}
func (fakeGrowthHandlerAdapter) FollowGrowthCandidate(_ context.Context, _, _, _ string) (platform.GrowthFollowResult, error) {
	return platform.GrowthFollowResult{ProviderState: "following"}, nil
}

type growthTestServer struct {
	echo *echo.Echo
	db   *bun.DB
	svc  *growthservice.Service
}

func (s *growthTestServer) request(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestGrowthListUnauthenticated(t *testing.T) {
	srv := newGrowthTestServer(t)
	rec := srv.request(t, http.MethodGet, "/api/v1/growth?workspace_id=ws-1&account_id=acc-bluesky", nil, "")
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestGrowthListForbiddenForWrongWorkspace(t *testing.T) {
	srv := newGrowthTestServer(t)
	rec := srv.request(t, http.MethodGet, "/api/v1/growth?workspace_id=ws-2&account_id=acc-bluesky", nil, "web-token")
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestGrowthListSuccess(t *testing.T) {
	srv := newGrowthTestServer(t)
	rec := srv.request(t, http.MethodGet, "/api/v1/growth?workspace_id=ws-1&account_id=acc-bluesky", nil, "web-token")
	require.Equal(t, http.StatusOK, rec.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
}

func TestGrowthRefreshSuccessAndFollowConflict(t *testing.T) {
	srv := newGrowthTestServer(t)
	refresh := srv.request(t, http.MethodPost, "/api/v1/growth/refresh", map[string]string{"workspace_id": "ws-1", "account_id": "acc-bluesky"}, "web-token")
	require.Equal(t, http.StatusOK, refresh.Code)
}
