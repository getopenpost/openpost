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

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestSocialSetRejectsSettingsOutsideAccountAndScope(t *testing.T) {
	server := newSocialSetsTestServer(t)
	for _, setting := range []map[string]any{
		{"default_settings": map[string]any{"poll_options": "Yes\nNo"}},
		{"default_settings": map[string]any{"instagram_product_type": "STORY"}},
		{"default_segment_settings": map[string]any{"reply_settings": "following"}},
	} {
		account := map[string]any{"social_account_id": "acc-1", "default_output_profile": "x.post"}
		for key, value := range setting {
			account[key] = value
		}
		response := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
			"workspace_id": "ws-1", "name": "Invalid", "accounts": []map[string]any{account},
		})
		require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	}
}

func TestSocialSetDefaultsValidateValuesAndAccountMode(t *testing.T) {
	server := newSocialSetsTestServer(t)
	_, err := server.db.NewInsert().Model(&[]models.SocialAccount{
		{ID: "discord-bot", WorkspaceID: "ws-1", Platform: "discord", CapabilityState: `{"connection_type":"bot"}`, AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "discord-webhook", WorkspaceID: "ws-1", Platform: "discord", CapabilityState: `{"connection_type":"webhook"}`, AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "tiktok-photo", WorkspaceID: "ws-1", Platform: "tiktok", AccessTokenEnc: []byte("token"), IsActive: true},
	}).Exec(t.Context())
	require.NoError(t, err)
	for _, scenario := range []struct {
		name    string
		account map[string]any
		status  int
	}{
		{"bot channel preset", map[string]any{"social_account_id": "discord-bot", "default_settings": map[string]any{"channel_id": "channel-1"}}, http.StatusOK},
		{"bot channel can wait for post", map[string]any{"social_account_id": "discord-bot"}, http.StatusOK},
		{"mention choice needs channel", map[string]any{"social_account_id": "discord-bot", "default_settings": map[string]any{"mention_policy": "selected"}}, http.StatusBadRequest},
		{"webhook has fixed channel", map[string]any{"social_account_id": "discord-webhook", "default_settings": map[string]any{"channel_id": "channel-1"}}, http.StatusBadRequest},
		{"invalid embed JSON", map[string]any{"social_account_id": "discord-bot", "default_settings": map[string]any{"embed": "{bad"}}, http.StatusBadRequest},
		{"embed needs content", map[string]any{"social_account_id": "discord-bot", "default_settings": map[string]any{"embed": `{"footer":{}}`}}, http.StatusBadRequest},
		{"valid embed preset", map[string]any{"social_account_id": "discord-bot", "default_settings": map[string]any{"embed": `{"title":"Launch"}`}}, http.StatusOK},
		{"invalid select option", map[string]any{"social_account_id": "acc-1", "default_settings": map[string]any{"reply_settings": "bogus"}}, http.StatusBadRequest},
		{"invalid boolean type", map[string]any{"social_account_id": "acc-1", "default_settings": map[string]any{"made_with_ai": "yes"}}, http.StatusBadRequest},
		{"photo title too long", map[string]any{"social_account_id": "tiktok-photo", "default_output_profile": "tiktok.photo", "default_settings": map[string]any{"photo_title": strings.Repeat("a", 91)}}, http.StatusBadRequest},
		{"attachment preset needs post media", map[string]any{"social_account_id": "acc-2", "default_output_profile": "instagram.reel", "default_settings": map[string]any{"cover_media_id": "media-from-another-workspace"}}, http.StatusBadRequest},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if scenario.account["default_output_profile"] == nil {
				if scenario.account["social_account_id"] == "acc-1" {
					scenario.account["default_output_profile"] = "x.post"
				} else {
					scenario.account["default_output_profile"] = "discord.post"
				}
			}
			response := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
				"workspace_id": "ws-1", "name": scenario.name, "accounts": []map[string]any{scenario.account},
			})
			require.Equal(t, scenario.status, response.Code, response.Body.String())
			if scenario.name == "attachment preset needs post media" {
				require.Contains(t, response.Body.String(), "Choose media-specific settings on the post")
			}
		})
	}
}

type unavailableAccountCapabilityAdapter struct {
	platform.Adapter
	calls *int
}

func (a unavailableAccountCapabilityAdapter) ResolveAccountPublishingCapabilities(context.Context, string, platform.AccountCapabilityInput) (platform.AccountCapabilityResult, error) {
	(*a.calls)++
	return platform.AccountCapabilityResult{}, errors.New("provider temporarily unavailable")
}

func TestSocialSetNameEditKeepsUnchangedDefaultsDuringProviderOutage(t *testing.T) {
	server := newSocialSetsTestServer(t)
	created := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
		"workspace_id": "ws-1", "name": "Before",
		"accounts": []map[string]any{{"social_account_id": "acc-1", "default_output_profile": "x.post", "default_settings": map[string]any{"reply_settings": "following"}}},
	})
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var set SocialSetResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &set))
	empty := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
		"workspace_id": "ws-1", "name": "Empty",
		"accounts": []map[string]any{{"social_account_id": "acc-1", "default_output_profile": "x.post"}},
	})
	require.Equal(t, http.StatusOK, empty.Code, empty.Body.String())
	var emptySet SocialSetResponse
	require.NoError(t, json.Unmarshal(empty.Body.Bytes(), &emptySet))
	calls := 0
	server.socialSets.SetCapabilityResolver(NewCapabilityResolverHandler(server.db, testAuthenticator{}, map[string]platform.Adapter{
		"x": unavailableAccountCapabilityAdapter{calls: &calls},
	}, capabilityResolverTokenSource{}))
	updated := server.request(t, http.MethodPut, "/api/v1/social-sets/"+set.ID, map[string]any{
		"name": "After", "is_default": true,
		"accounts": []map[string]any{{"social_account_id": "acc-1", "default_output_profile": "x.post", "default_settings": map[string]any{"reply_settings": "following"}}},
	})
	require.Equal(t, http.StatusOK, updated.Code, updated.Body.String())
	var saved SocialSetResponse
	require.NoError(t, json.Unmarshal(updated.Body.Bytes(), &saved))
	require.Equal(t, "After", saved.Name)
	require.Equal(t, "following", saved.Accounts[0].DefaultSettings["reply_settings"])
	require.Zero(t, calls)

	unchangedEmpty := server.request(t, http.MethodPut, "/api/v1/social-sets/"+emptySet.ID, map[string]any{
		"name": "Empty renamed", "is_default": false,
		"accounts": []map[string]any{{"social_account_id": "acc-1", "default_output_profile": "x.post", "default_settings": map[string]any{}}},
	})
	require.Equal(t, http.StatusOK, unchangedEmpty.Code, unchangedEmpty.Body.String())
	require.Zero(t, calls)

	changed := server.request(t, http.MethodPut, "/api/v1/social-sets/"+set.ID, map[string]any{
		"name": "After", "is_default": true,
		"accounts": []map[string]any{{"social_account_id": "acc-1", "default_output_profile": "x.post", "default_settings": map[string]any{"reply_settings": "mentionedUsers"}}},
	})
	require.Equal(t, http.StatusBadGateway, changed.Code, changed.Body.String())
	require.Equal(t, 1, calls)
}

type socialSetsTestServer struct {
	echo       *echo.Echo
	db         *bun.DB
	socialSets *SocialSetHandler
}

func newSocialSetsTestServer(t *testing.T) *socialSetsTestServer {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.SocialSet)(nil),
		(*models.SocialSetAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1", UserID: "user-1", Role: "admin",
	}).Exec(ctx)
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{ID: "acc-1", WorkspaceID: "ws-1", Slug: "x", Platform: "x", AccountID: "1", AccountUsername: "openpost", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "acc-2", WorkspaceID: "ws-1", Slug: "instagram", Platform: "instagram", AccountID: "2", AccountUsername: "openpost", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "acc-3", WorkspaceID: "ws-1", Slug: "facebook", Platform: "facebook", AccountID: "3", AccountUsername: "openpost", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	socialSets := NewSocialSetHandler(db, testAuthenticator{})
	socialSets.RegisterRoutes(api)
	return &socialSetsTestServer{echo: e, db: db, socialSets: socialSets}
}

func (s *socialSetsTestServer) request(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	recorder := httptest.NewRecorder()
	s.echo.ServeHTTP(recorder, req)
	return recorder
}
