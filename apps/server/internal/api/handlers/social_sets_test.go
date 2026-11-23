package handlers

import (
	"bytes"
	"context"
	"encoding/json"

	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestSocialSetsPreserveMembershipOrderAndFormatDefaults(t *testing.T) {
	server := newSocialSetsTestServer(t)
	response := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
		"workspace_id": "ws-1",
		"name":         "Launch",
		"is_default":   true,
		"accounts": []map[string]any{
			{"social_account_id": "acc-2", "default_output_profile": "instagram.story"},
			{"social_account_id": "acc-1", "default_output_profile": "x.thread", "default_settings": map[string]any{"reply_settings": "following"}},
		},
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	var created SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &created))
	require.Equal(t, "Launch", created.Name)
	require.True(t, created.IsDefault)
	require.Equal(t, []string{"acc-2", "acc-1"}, []string{
		created.Accounts[0].SocialAccountID,
		created.Accounts[1].SocialAccountID,
	})
	require.Equal(t, "instagram.story", created.Accounts[0].DefaultOutputProfile)
	require.Equal(t, "x.thread", created.Accounts[1].DefaultOutputProfile)
	require.Equal(t, "following", created.Accounts[1].DefaultSettings["reply_settings"])

	response = server.request(t, http.MethodGet, "/api/v1/social-sets?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var listed []SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	require.Equal(t, created.ID, listed[0].ID)
	require.Equal(t, created.Accounts[1].DefaultSettings, listed[0].Accounts[1].DefaultSettings)

	response = server.request(t, http.MethodPut, "/api/v1/social-sets/"+created.ID, map[string]any{
		"name": "Launch", "is_default": true,
		"accounts": []map[string]any{{"social_account_id": "acc-1", "default_output_profile": "x.post", "default_settings": map[string]any{"made_with_ai": true}}},
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var updated SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &updated))
	require.Equal(t, true, updated.Accounts[0].DefaultSettings["made_with_ai"])
	require.Empty(t, updated.Accounts[0].DefaultSegmentSettings)
}

func TestSocialSetSegmentDefaultPersists(t *testing.T) {
	server := newSocialSetsTestServer(t)
	response := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
		"workspace_id": "ws-1", "name": "Facebook comments",
		"accounts": []map[string]any{{
			"social_account_id": "acc-3", "default_output_profile": "facebook.post",
			"default_segment_settings": map[string]any{"first_comment": "More details"},
		}},
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var created SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &created))
	require.Equal(t, "More details", created.Accounts[0].DefaultSegmentSettings["first_comment"])
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

func TestSocialSetPresetUsesAccountResolvedVideoSettings(t *testing.T) {
	server := newSocialSetsTestServer(t)
	_, err := server.db.NewInsert().Model(&models.SocialAccount{
		ID: "tiktok-1", WorkspaceID: "ws-1", Platform: "tiktok", AccountID: "creator-1",
		AccessTokenEnc: []byte("token"), IsActive: true,
	}).Exec(t.Context())
	require.NoError(t, err)
	server.socialSets.SetCapabilityResolver(NewCapabilityResolverHandler(server.db, testAuthenticator{}, map[string]platform.Adapter{
		"tiktok": xCapabilityResolverAdapter{result: platform.AccountCapabilityResult{
			AvailableFeatures:     map[string]bool{"duet": false, "stitch": false, "is_aigc": true},
			CompleteOptionSources: []string{"tiktok_privacy_levels"},
			Options: map[string][]platform.DestinationOption{
				"tiktok_privacy_levels": {{Value: "PUBLIC_TO_EVERYONE", Label: "Everyone"}},
			},
		}},
	}, capabilityResolverTokenSource{}))

	response := server.request(t, http.MethodPost, "/api/v1/social-sets/resolve-settings", map[string]any{
		"social_account_id": "tiktok-1", "default_output_profile": "tiktok.video",
		"settings": map[string]any{"content_posting_method": "DIRECT_POST"},
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var resolved struct {
		OutputProfile string                           `json:"output_profile"`
		Settings      []capabilities.SettingDefinition `json:"settings"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &resolved))
	require.Equal(t, "tiktok.video", resolved.OutputProfile)
	fields := map[string]capabilities.SettingDefinition{}
	for _, setting := range resolved.Settings {
		fields[setting.Key] = setting
	}
	require.NotEmpty(t, fields["duet"].UnavailableReason)
	require.Empty(t, fields["is_aigc"].UnavailableReason)
	require.NotContains(t, fields, "photo_title")

	for _, scenario := range []struct {
		name     string
		settings map[string]any
		status   int
	}{
		{"disabled duet", map[string]any{"content_posting_method": "DIRECT_POST", "duet": false}, http.StatusBadRequest},
		{"privacy outside creator choices", map[string]any{"content_posting_method": "DIRECT_POST", "privacy_level": "FRIENDS"}, http.StatusBadRequest},
		{"privacy in creator choices", map[string]any{"content_posting_method": "DIRECT_POST", "privacy_level": "PUBLIC_TO_EVERYONE"}, http.StatusOK},
		{"available video option", map[string]any{"content_posting_method": "DIRECT_POST", "is_aigc": true}, http.StatusOK},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			created := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
				"workspace_id": "ws-1", "name": scenario.name,
				"accounts": []map[string]any{{
					"social_account_id": "tiktok-1", "default_output_profile": "tiktok.video",
					"default_settings": scenario.settings,
				}},
			})
			require.Equal(t, scenario.status, created.Code, created.Body.String())
		})
	}
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
