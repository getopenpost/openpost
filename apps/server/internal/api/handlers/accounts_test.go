package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestRefreshAccountMetadataUpdatesTheExactStoredAccount(t *testing.T) {
	t.Parallel()

	adapter := &accountMetadataAdapter{profile: &platform.UserProfile{
		ID:        "provider-account-1",
		Username:  "current-name",
		AvatarURL: "https://cdn.example/current-avatar.jpg",
	}}
	srv := newAccountMetadataTestServer(t, adapter)

	resp := srv.request(t)
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, "access-token", adapter.accessToken)

	var out AccountResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "current-name", out.AccountUsername)
	require.Equal(t, "https://cdn.example/current-avatar.jpg", out.AccountAvatarURL)

	var account models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "acc-1").Scan(t.Context()))
	require.Equal(t, "current-name", account.AccountUsername)
	require.Equal(t, "https://cdn.example/current-avatar.jpg", account.AccountAvatarURL)
	require.Equal(t, "kept-slug", account.Slug)
	require.Equal(t, "grant-1", account.OAuthGrantID)
	require.Equal(t, `{"connection_type":"oauth"}`, account.CapabilityState)
}

func TestRefreshAccountMetadataCachesProviderAvatarOnOpenPost(t *testing.T) {
	for _, backend := range []struct {
		name   string
		create func(testing.TB, ...any) *bun.DB
	}{{"sqlite", createHandlerTestDB}, {"postgres", createHandlerPostgresTestDB}} {
		t.Run(backend.name, func(t *testing.T) {
			for _, provider := range []string{"linkedin", "facebook", "instagram", "threads", "x"} {
				t.Run(provider, func(t *testing.T) {
					providerURL := "https://cdn.example/current-avatar.jpg?signature=temporary"
					adapter := &accountMetadataAdapter{profile: &platform.UserProfile{
						ID: "provider-account-1", Username: "current-name", AvatarURL: providerURL,
					}}
					srv := newAccountMetadataTestServerWithDatabase(t, adapter, backend.create)
					_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).
						Set("platform = ?", provider).Where("id = ?", "acc-1").Exec(t.Context())
					require.NoError(t, err)
					srv.handler.providers = map[string]platform.Adapter{provider: adapter}
					cache := &accountAvatarCacheStub{url: "/avatars/avatar_account_acc-1_current.jpg"}
					srv.handler.accountAvatars = cache

					resp := srv.request(t)
					require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
					var out AccountResponse
					require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
					require.Equal(t, cache.url, out.AccountAvatarURL, "refresh must not persist an expiring provider URL")
					var account models.SocialAccount
					require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "acc-1").Scan(t.Context()))
					require.Equal(t, cache.url, account.AccountAvatarURL)
					require.Equal(t, "acc-1", cache.accountID)
					require.Equal(t, providerURL, cache.providerURL)
				})
			}
		})
	}
}

func TestRefreshAccountMetadataPreservesStoredValuesWhenProviderOmitsThem(t *testing.T) {
	t.Parallel()

	srv := newAccountMetadataTestServer(t, &accountMetadataAdapter{profile: &platform.UserProfile{
		ID:       "provider-account-1",
		Username: "  ",
	}})

	resp := srv.request(t)
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())

	var account models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "acc-1").Scan(t.Context()))
	require.Equal(t, "stored-name", account.AccountUsername)
	require.Equal(t, "https://cdn.example/stored-avatar.jpg", account.AccountAvatarURL)
}

func TestRefreshAccountMetadataRejectsProviderIdentityMismatch(t *testing.T) {
	t.Parallel()

	srv := newAccountMetadataTestServer(t, &accountMetadataAdapter{profile: &platform.UserProfile{
		ID:        "different-provider-account",
		Username:  "wrong-name",
		AvatarURL: "https://cdn.example/wrong-avatar.jpg",
	}})

	resp := srv.request(t)
	require.Equal(t, http.StatusConflict, resp.Code, resp.Body.String())

	var account models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "acc-1").Scan(t.Context()))
	require.Equal(t, "stored-name", account.AccountUsername)
	require.Equal(t, "https://cdn.example/stored-avatar.jpg", account.AccountAvatarURL)
}

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

func TestRefreshAccountMetadataRequiresWorkspaceEditAccess(t *testing.T) {
	t.Parallel()

	adapter := &accountMetadataAdapter{profile: &platform.UserProfile{ID: "provider-account-1"}}
	srv := newAccountMetadataTestServer(t, adapter)
	_, err := srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").
		Exec(t.Context())
	require.NoError(t, err)

	resp := srv.request(t)
	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Empty(t, adapter.accessToken, "provider must not be called without edit access")
}

func TestRefreshAccountMetadataRejectsUnsupportedProviders(t *testing.T) {
	t.Parallel()

	t.Run("provider without refresh support leaves stored values", func(t *testing.T) {
		t.Parallel()

		srv := newAccountMetadataTestServer(t, nil)
		resp := srv.request(t)
		require.Equal(t, http.StatusNotImplemented, resp.Code, resp.Body.String())

		var account models.SocialAccount
		require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "acc-1").Scan(t.Context()))
		require.Equal(t, "stored-name", account.AccountUsername)
		require.Equal(t, "https://cdn.example/stored-avatar.jpg", account.AccountAvatarURL)
	})

	t.Run("unsupported destination kind maps to not implemented", func(t *testing.T) {
		t.Parallel()

		adapter := &destinationAccountMetadataAdapter{
			accountMetadataAdapter: accountMetadataAdapter{profile: &platform.UserProfile{ID: "authorization-owner"}},
			refreshErr:             errors.Join(platform.ErrAccountMetadataRefreshUnsupported, errors.New("unknown destination kind")),
		}
		srv := newAccountMetadataTestServer(t, adapter)

		resp := srv.request(t)
		require.Equal(t, http.StatusNotImplemented, resp.Code, resp.Body.String())
	})
}

func TestRefreshAccountMetadataRejectsConnectorAccountsBeforeProviderAccess(t *testing.T) {
	t.Parallel()

	adapter := &accountMetadataAdapter{profile: &platform.UserProfile{ID: "provider-account-1"}}
	srv := newAccountMetadataTestServer(t, adapter)
	srv.handler.connectorStore = connectors.NewStore(srv.db)
	_, err := srv.db.NewInsert().Model(&models.ProviderAccountBinding{
		SocialAccountID:   "acc-1",
		WorkspaceID:       "ws-1",
		InstallationID:    "connector-installation-1",
		ExternalAccountID: "provider-account-1",
	}).Exec(t.Context())
	require.NoError(t, err)

	resp := srv.request(t)
	require.Equal(t, http.StatusNotImplemented, resp.Code, resp.Body.String())
	require.Empty(t, adapter.accessToken, "built-in provider must not receive connector credentials")
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

func TestAccountAliasPreservesProviderIdentity(t *testing.T) {
	srv := newAccountMetadataTestServer(t, nil)
	for _, body := range []string{`{"slug":"team-x","alias":"Launch account"}`, `{"slug":"team-x"}`} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/v1/accounts/acc-1", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer web-token")
		rec := httptest.NewRecorder()
		srv.echo.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var response map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &response))
		require.Equal(t, "Launch account", response["alias"])
		var stored models.SocialAccount
		require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", "acc-1").Scan(t.Context()))
		require.Equal(t, "stored-name", stored.AccountUsername)
	}
}

func TestRefreshAccountPhotoDownloadFailureKeepsStoredProfile(t *testing.T) {
	adapter := &accountMetadataAdapter{profile: &platform.UserProfile{ID: "provider-account-1", Username: "changed-name", AvatarURL: "https://cdn.example/photo"}}
	srv := newAccountMetadataTestServer(t, adapter)
	cache := &accountAvatarCacheStub{err: errors.New("download failed")}
	srv.handler.accountAvatars = cache
	resp := srv.request(t)
	require.Equal(t, http.StatusBadGateway, resp.Code, resp.Body.String())
	var stored models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", "acc-1").Scan(t.Context()))
	require.Equal(t, "stored-name", stored.AccountUsername)
	require.Equal(t, "https://cdn.example/stored-avatar.jpg", stored.AccountAvatarURL)
	require.Empty(t, cache.deleted)
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
