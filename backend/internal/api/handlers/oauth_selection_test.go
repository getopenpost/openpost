package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

type selectionTestAdapter struct {
	exchangeCalls int
	profileCalls  int
	listCalls     int
	selectCalls   int
	onSelect      func()
}

func (a *selectionTestAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return "https://provider.example/oauth?state=" + url.QueryEscape(state), nil
}

func (a *selectionTestAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	a.exchangeCalls++
	return &platform.TokenResult{
		AccessToken:  "user-access-token",
		RefreshToken: "user-refresh-token",
		ExpiresIn:    3600,
		TokenType:    "Bearer",
		Extra: map[string]string{
			"scope": "pages",
		},
	}, nil
}

func (a *selectionTestAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}

func (a *selectionTestAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}

func (a *selectionTestAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	a.profileCalls++
	return &platform.UserProfile{ID: "direct-user", Username: "direct"}, nil
}

func (a *selectionTestAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}

func (a *selectionTestAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func (a *selectionTestAdapter) ListAccountSelections(_ context.Context, token *platform.TokenResult) ([]platform.AccountSelectionOption, error) {
	a.listCalls++
	if token.AccessToken != "user-access-token" {
		return nil, nil
	}
	return []platform.AccountSelectionOption{
		{ID: "page-1", DisplayName: "Main Page", Username: "main-page", Kind: "page"},
		{ID: "page-2", DisplayName: "OpenPost Image Editor Page", Username: "studio", AvatarURL: "https://cdn.example/image-editor.png", Kind: "page"},
	}, nil
}

func (a *selectionTestAdapter) SelectAccount(_ context.Context, token *platform.TokenResult, selectionID string) (*platform.SelectedAccount, error) {
	a.selectCalls++
	if a.onSelect != nil {
		a.onSelect()
	}
	if token.AccessToken != "user-access-token" || selectionID != "page-2" {
		return nil, nil
	}
	return &platform.SelectedAccount{
		AccountID:        "page-2",
		AccountUsername:  "studio",
		AccountAvatarURL: "https://cdn.example/image-editor.png",
		Token: &platform.TokenResult{
			AccessToken: "page-access-token",
			ExpiresIn:   7200,
			TokenType:   "Bearer",
			Extra: map[string]string{
				"selected": selectionID,
			},
		},
	}, nil
}

func TestOAuthCallbackCreatesAndCompletesAccountSelection(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	adapter := &selectionTestAdapter{}
	handler := NewOAuthHandler(db, encryptor, map[string]platform.Adapter{
		"facebook": adapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthConnectionReadiness(
		t,
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled},
		platform.AppConfig{Provider: "facebook", ClientID: "facebook-app"},
	))
	handler.GetAuthURL(api)
	handler.Callback(api)
	handler.GetAccountSelection(api)
	handler.CompleteAccountSelection(api)

	authURLResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/facebook/auth-url?workspace_id=ws-1", nil, true)
	require.Equal(t, http.StatusOK, authURLResp.Code, authURLResp.Body.String())
	var authURLBody struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(authURLResp.Body.Bytes(), &authURLBody))
	parsedAuthURL, err := url.Parse(authURLBody.URL)
	require.NoError(t, err)
	state := parsedAuthURL.Query().Get("state")
	require.NotEmpty(t, state)

	callbackResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/facebook/callback?code=provider-code&state="+url.QueryEscape(state), nil, false)
	callbackResult := callbackResp.Result()
	t.Cleanup(func() { _ = callbackResult.Body.Close() })
	require.Equal(t, http.StatusTemporaryRedirect, callbackResult.StatusCode, callbackResp.Body.String())
	location := callbackResult.Header.Get("Location")
	require.Contains(t, location, "status=selection_required")
	require.Contains(t, location, "platform=facebook")
	callbackURL, err := url.Parse(location)
	require.NoError(t, err)
	connectionID := callbackURL.Query().Get("connection_id")
	require.NotEmpty(t, connectionID)
	require.Equal(t, 1, adapter.profileCalls, "selection adapters resolve the authorizing subject before saving destinations")

	selectionResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/selections/"+connectionID, nil, true)
	require.Equal(t, http.StatusOK, selectionResp.Code, selectionResp.Body.String())
	require.NotContains(t, selectionResp.Body.String(), "user-access-token")
	require.NotContains(t, selectionResp.Body.String(), "user-refresh-token")
	var selectionBody AccountSelectionResponse
	require.NoError(t, json.Unmarshal(selectionResp.Body.Bytes(), &selectionBody))
	require.Equal(t, "facebook", selectionBody.Platform)
	require.Equal(t, "ws-1", selectionBody.WorkspaceID)
	require.Len(t, selectionBody.Options, 2)
	require.Equal(t, "OpenPost Image Editor Page", selectionBody.Options[1].DisplayName)

	completeResp := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/selections/"+connectionID+"/complete", map[string]string{
		"selection_id": "page-2",
	}, true)
	require.Equal(t, http.StatusOK, completeResp.Code, completeResp.Body.String())
	var accountBody AccountResponse
	require.NoError(t, json.Unmarshal(completeResp.Body.Bytes(), &accountBody))
	require.Equal(t, "facebook", accountBody.Platform)
	require.Equal(t, "page-2", accountBody.AccountID)
	require.Equal(t, "studio", accountBody.AccountUsername)
	require.Equal(t, "https://cdn.example/image-editor.png", accountBody.AccountAvatarURL)

	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", accountBody.ID).Scan(ctx))
	require.Equal(t, "https://cdn.example/image-editor.png", account.AccountAvatarURL)
	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", account.OAuthGrantID).Scan(ctx))
	decryptedAccess, err := encryptor.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, "page-access-token", decryptedAccess)

	var pending models.OAuthAccountSelection
	require.NoError(t, db.NewSelect().Model(&pending).Where("id = ?", connectionID).Scan(ctx))
	require.False(t, pending.ConsumedAt.IsZero())

	selectionAfterComplete := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/selections/"+connectionID, nil, true)
	require.Equal(t, http.StatusNotFound, selectionAfterComplete.Code)
}

func TestPendingAccountSelectionPreservesRefreshTokenExpiry(t *testing.T) {
	db := createHandlerTestDB(t, (*models.OAuthAccountSelection)(nil))
	handler := NewOAuthHandler(
		db,
		crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"),
		nil,
		testAuthenticator{},
		false,
		"https://app.openpost.test",
	)

	pending, err := handler.createPendingAccountSelection(
		t.Context(),
		"user-1",
		"linkedin",
		"workspace-1",
		"",
		"production",
		&platform.TokenResult{
			AccessToken:      "access-token",
			RefreshToken:     "refresh-token",
			ExpiresIn:        3600,
			RefreshExpiresIn: 7200,
			Extra:            map[string]string{"scope": "w_member_social"},
		},
		nil,
	)
	require.NoError(t, err)

	restored, err := handler.tokenResultFromPendingSelection(pending)
	require.NoError(t, err)
	require.Equal(t, "access-token", restored.AccessToken)
	require.Equal(t, "refresh-token", restored.RefreshToken)
	require.InDelta(t, 7200, restored.RefreshExpiresIn, 2)
	require.Equal(t, "w_member_social", restored.Extra["scope"])
	require.NotContains(t, restored.Extra, pendingSelectionRefreshExpiresAtKey)
}

func TestGetAuthURLRejectsMissingSocialAccountEntitlement(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
	)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewOAuthHandler(
		db,
		crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"),
		map[string]platform.Adapter{"selectable": &selectionTestAdapter{}},
		testAuthenticator{},
		false,
		"https://app.openpost.test",
	)
	handler.SetEntitlement(entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitSocialAccounts: 0,
		},
	}))
	handler.GetAuthURL(api)

	resp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/selectable/auth-url?workspace_id=ws-1", nil, true)
	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "Social account limit reached")
}

func oauthSelectionRequest(t *testing.T, e *echo.Echo, method, path string, body any, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	var payload io.Reader
	if body != nil {
		buf := bytes.NewBuffer(nil)
		require.NoError(t, json.NewEncoder(buf).Encode(body))
		payload = buf
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, payload)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		req.Header.Set("Authorization", "Bearer web-token")
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
