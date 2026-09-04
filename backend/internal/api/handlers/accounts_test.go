package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
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

	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.ProviderAccountBinding)(nil))
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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
