package handlers

import (
	"context"

	"io"
	"net/http"
	"net/http/httptest"

	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestRefreshAccountMetadataUsesDestinationAwareProviderCapability(t *testing.T) {
	t.Parallel()

	adapter := &destinationAccountMetadataAdapter{
		accountMetadataAdapter: accountMetadataAdapter{profile: &platform.UserProfile{ID: "authorization-owner"}},
		refreshedProfile:       &platform.UserProfile{ID: "provider-account-1", Username: "exact-destination"},
	}
	srv := newAccountMetadataTestServer(t, adapter)

	resp := srv.request(t)
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, "provider-account-1", adapter.request.AccountID)
	require.Equal(t, "oauth", adapter.request.CapabilityState["connection_type"])
	require.Empty(t, adapter.accessToken, "generic authorization-owner profile must not be fetched")
}

type accountMetadataTokenSource struct {
	err error
}

type accountAvatarCacheStub struct {
	url         string
	accountID   string
	providerURL string
	err         error
	deleted     []string
	before      func()
}

func (cache *accountAvatarCacheStub) CacheAvatar(_ context.Context, accountID, providerURL string) (string, error) {
	if cache.before != nil {
		cache.before()
	}
	cache.accountID = accountID
	cache.providerURL = providerURL
	return cache.url, cache.err
}

func (cache *accountAvatarCacheStub) Delete(_ context.Context, url string) error {
	cache.deleted = append(cache.deleted, url)
	return nil
}

func (source accountMetadataTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "access-token", source.err
}

type accountMetadataAdapter struct {
	platform.Adapter
	profile     *platform.UserProfile
	accessToken string
}

func (adapter *accountMetadataAdapter) GetProfile(_ context.Context, accessToken string) (*platform.UserProfile, error) {
	adapter.accessToken = accessToken
	return adapter.profile, nil
}

func (adapter *accountMetadataAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}

type destinationAccountMetadataAdapter struct {
	accountMetadataAdapter
	refreshedProfile *platform.UserProfile
	refreshErr       error
	request          platform.AccountMetadataRequest
}

func (adapter *destinationAccountMetadataAdapter) RefreshAccountMetadata(_ context.Context, _ string, input platform.AccountMetadataRequest) (*platform.UserProfile, error) {
	adapter.request = input
	return adapter.refreshedProfile, adapter.refreshErr
}

func newAccountMetadataTestServer(t *testing.T, adapter platform.Adapter) *accountsTestServer {
	t.Helper()
	return newAccountMetadataTestServerWithDatabase(t, adapter, createHandlerTestDB)
}

func newAccountMetadataTestServerWithDatabase(t *testing.T, adapter platform.Adapter, create func(testing.TB, ...any) *bun.DB) *accountsTestServer {
	t.Helper()
	db := create(t, (*models.OAuthGrant)(nil), (*models.Organization)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.ProviderAccountBinding)(nil))
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Organization"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "Workspace"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "acc-1", WorkspaceID: "ws-1", Slug: "kept-slug", Platform: "x",
		AccountID: "provider-account-1", AccountUsername: "stored-name",
		AccountAvatarURL: "https://cdn.example/stored-avatar.jpg", OAuthGrantID: "grant-1",
		AccessTokenEnc: []byte("legacy-placeholder"), CapabilityState: `{"connection_type":"oauth"}`,
		IsActive: true,
	}).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := &OAuthHandler{
		db: db, auth: testAuthenticator{}, providers: map[string]platform.Adapter{"x": adapter},
		tokenSource: accountMetadataTokenSource{},
	}
	handler.UpdateAccount(api)
	handler.RefreshAccountMetadata(api)

	return &accountsTestServer{echo: e, db: db, handler: handler}
}

type accountsTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	handler *OAuthHandler
}

func (s *accountsTestServer) request(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/accounts/acc-1/refresh-metadata", nil)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestRefreshAccountPhotoDoesNotOverwriteAConcurrentRefresh(t *testing.T) {
	adapter := &accountMetadataAdapter{profile: &platform.UserProfile{ID: "provider-account-1", Username: "changed-name", AvatarURL: "https://cdn.example/photo"}}
	srv := newAccountMetadataTestServer(t, adapter)
	cache := &accountAvatarCacheStub{url: "/avatars/avatar_account_losing_refresh.jpg"}
	cache.before = func() {
		_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("account_avatar_url = ?", "/avatars/avatar_account_newer.jpg").Where("id = ?", "acc-1").Exec(t.Context())
		require.NoError(t, err)
	}
	srv.handler.accountAvatars = cache
	resp := srv.request(t)
	require.Equal(t, http.StatusConflict, resp.Code, resp.Body.String())
	var stored models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", "acc-1").Scan(t.Context()))
	require.Equal(t, "/avatars/avatar_account_newer.jpg", stored.AccountAvatarURL)
	require.Equal(t, []string{cache.url}, cache.deleted)
}
