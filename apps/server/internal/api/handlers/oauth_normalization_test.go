package handlers

import (
	"context"
	"encoding/json"
	"errors"

	"net/http"

	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

func newNormServer(t *testing.T, providers map[string]platform.Adapter) (*echo.Echo, *OAuthHandler) {
	t.Helper()
	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
		(*models.AccountFeature)(nil),
		(*models.OAuthGrant)(nil),
		(*models.WorkspaceFirstConnection)(nil),
		(*models.OAuthAccountSelectionReservation)(nil),
	)
	seedOAuthTestWorkspace(t, db)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	if providers == nil {
		providers = map[string]platform.Adapter{}
	}
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	enc := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	handler := NewOAuthHandler(db, enc, providers, testAuthenticator{}, false, "https://app.openpost.test")
	af := accountfeatures.NewService(db, providers, nil)
	handler.SetAccountFeaturesService(af)
	apps := make([]platform.AppConfig, 0, len(providers))
	for p := range providers {
		key := p
		if len(p) > 8 && p[:8] == "mastodon" {
			key = "mastodon"
		}
		apps = append(apps, platform.AppConfig{Provider: key, ClientID: key + "-app"})
	}
	if len(apps) == 0 {
		apps = []platform.AppConfig{{Provider: "threads", ClientID: "threads-app"}}
	}
	handler.SetProviderReadiness(oauthConnectionReadiness(t, &oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled}, apps...))
	handler.GetAuthURL(api)
	handler.Callback(api)
	handler.ExchangeCode(api)
	handler.BlueskyLogin(api)
	handler.DiscordWebhookLogin(api)
	handler.GetAccountSelection(api)
	handler.CompleteAccountSelection(api)
	return e, handler
}

func TestBlueskyLoginUsesSessionIdentityWhenActorProfileIsUnavailable(t *testing.T) {
	t.Parallel()
	const pdsURL = "https://pds.example"

	e, handler := newNormServer(t, map[string]platform.Adapter{
		"bluesky": &loginSessionFixture{BlueskyAdapter: platform.NewBlueskyAdapter(pdsURL), did: "did:plc:creator"},
	})
	handler.setBlueskyPDSResolver(func(context.Context, string) (string, string, error) {
		return "", "", nil
	})
	response := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/bluesky/login", map[string]string{
		"workspace_id": "ws-1",
		"handle":       "submitted.bsky.social",
		"app_password": "app-password",
	}, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	var account models.SocialAccount
	require.NoError(t, handler.db.NewSelect().Model(&account).Where("account_id = ?", "did:plc:creator").Scan(t.Context()))
	require.Equal(t, "canonical.bsky.social", account.AccountUsername)
	require.Equal(t, pdsURL, account.InstanceURL)
	require.Empty(t, account.AccountAvatarURL)

	var grant models.OAuthGrant
	require.NoError(t, handler.db.NewSelect().Model(&grant).Where("id = ?", account.OAuthGrantID).Scan(t.Context()))
	require.Equal(t, pdsURL, grant.ProviderProjectID)
	require.Equal(t, pdsURL, grant.InstanceURL)
	require.JSONEq(t, `{"exchange":"create_session","pds_url":"`+pdsURL+`","protocol":"atproto","source":"account_connection"}`, grant.AuthorizationEvidence)
}

type loginSessionFixture struct {
	*platform.BlueskyAdapter
	did string
}

func (a *loginSessionFixture) CreateSession(context.Context, string, string) (string, string, string, string, int, error) {
	return a.did, "canonical.bsky.social", "access-token", "refresh-token", 3600, nil
}
func (a *loginSessionFixture) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, errors.New("profile unavailable")
}

func TestLegacyMessagingUpdateAcceptsNullCapabilityState(t *testing.T) {
	t.Parallel()
	for _, state := range []string{"null", "{}", `{"custom":"preserved"}`} {
		t.Run(state, func(t *testing.T) {
			e, handler := newNormServer(t, nil)
			handler.SetAccountFeaturesService(nil)
			api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			handler.UpdateAccount(api)
			_, err := handler.db.NewInsert().Model(&models.SocialAccount{
				ID: "account-null", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "page-1",
				Slug: "facebook", AccessTokenEnc: []byte("test-token"), IsActive: true, CapabilityState: state,
			}).Exec(t.Context())
			require.NoError(t, err)
			require.NotPanics(t, func() {
				response := oauthSelectionRequest(t, e, http.MethodPatch, "/api/v1/accounts/account-null", map[string]any{"slug": "facebook", "messages_enabled": false}, true)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			})
			var account models.SocialAccount
			require.NoError(t, handler.db.NewSelect().Model(&account).Where("id = ?", "account-null").Scan(t.Context()))
			var saved map[string]string
			require.NoError(t, json.Unmarshal([]byte(account.CapabilityState), &saved))
			require.Equal(t, "false", saved["messages_enabled"])
			if state != "null" && state != "{}" {
				require.Equal(t, "preserved", saved["custom"])
			}
		})
	}
}
