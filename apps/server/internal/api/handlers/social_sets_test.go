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
			{"social_account_id": "acc-1", "default_output_profile": "x.thread", "default_settings": map[string]any{"reply_settings": "following"}, "default_segment_settings": map[string]any{"poll_options": "Yes\nNo"}},
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
	require.Equal(t, "Yes\nNo", created.Accounts[1].DefaultSegmentSettings["poll_options"])

	response = server.request(t, http.MethodGet, "/api/v1/social-sets?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var listed []SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	require.Equal(t, created.ID, listed[0].ID)
	require.Equal(t, created.Accounts[1].DefaultSettings, listed[0].Accounts[1].DefaultSettings)

	response = server.request(t, http.MethodPut, "/api/v1/social-sets/"+created.ID, map[string]any{
		"name": "Launch", "is_default": true,
		"accounts": []map[string]any{{"social_account_id": "acc-1", "default_settings": map[string]any{"made_with_ai": true}}},
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var updated SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &updated))
	require.Equal(t, true, updated.Accounts[0].DefaultSettings["made_with_ai"])
	require.Empty(t, updated.Accounts[0].DefaultSegmentSettings)
}

func TestSocialSetRejectsSettingsOutsideAccountAndScope(t *testing.T) {
	server := newSocialSetsTestServer(t)
	for _, setting := range []map[string]any{
		{"default_settings": map[string]any{"poll_options": "Yes\nNo"}},
		{"default_settings": map[string]any{"instagram_product_type": "STORY"}},
		{"default_segment_settings": map[string]any{"reply_settings": "following"}},
	} {
		account := map[string]any{"social_account_id": "acc-1"}
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
		{"poll duration out of bounds", map[string]any{"social_account_id": "acc-1", "default_output_profile": "x.thread", "default_segment_settings": map[string]any{"poll_options": "Yes\nNo", "poll_duration_minutes": 20000}}, http.StatusBadRequest},
		{"attachment preset needs post media", map[string]any{"social_account_id": "acc-2", "default_output_profile": "instagram.story", "default_settings": map[string]any{"cover_media_id": "media-from-another-workspace"}}, http.StatusBadRequest},
	} {
		t.Run(scenario.name, func(t *testing.T) {
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

func TestSocialSetDefaultsFillOnlyMissingPublicationSettings(t *testing.T) {
	input := CreatePublicationBody{
		SourceText: "First post",
		Renditions: []RenditionInput{{
			SocialAccountID: "acc-1", OutputProfile: "x.post",
			Settings: map[string]any{"reply_settings": "mentionedUsers"},
			Segments: []RenditionSegmentInput{{Settings: map[string]any{"poll_options": "Mine"}}},
		}},
	}
	normalizePublicationCreateBody(&input)
	applySocialSetRenditionDefaults(&input, []SocialSetAccountInput{{
		SocialAccountID: "acc-1", DefaultOutputProfile: "x.thread",
		DefaultSettings:        map[string]any{"reply_settings": "following", "made_with_ai": true},
		DefaultSegmentSettings: map[string]any{"poll_options": "Default", "poll_duration_minutes": 60},
	}})
	require.Equal(t, "x.post", input.Renditions[0].OutputProfile)
	require.Equal(t, "mentionedUsers", input.Renditions[0].Settings["reply_settings"])
	require.Equal(t, true, input.Renditions[0].Settings["made_with_ai"])
	require.Equal(t, "Mine", input.Renditions[0].Segments[0].Settings["poll_options"])
	require.Equal(t, 60, input.Renditions[0].Segments[0].Settings["poll_duration_minutes"])

	input.Renditions = []RenditionInput{{SocialAccountID: "acc-1"}}
	applySocialSetRenditionDefaults(&input, []SocialSetAccountInput{{
		SocialAccountID: "acc-1", DefaultOutputProfile: "x.thread",
		DefaultSegmentSettings: map[string]any{"poll_options": "Default"},
	}})
	require.Equal(t, "x.thread", input.Renditions[0].OutputProfile)
	require.True(t, input.Renditions[0].FormatLocked)
	require.Equal(t, "Default", input.Renditions[0].Segments[0].Settings["poll_options"])
}

func TestSocialSetDefaultsSnapshotIntoNewPublicationWithoutChangingExistingDraft(t *testing.T) {
	srv := newMCPTestServer(t)
	ctx := context.Background()
	for _, model := range []any{(*models.SocialSet)(nil), (*models.SocialSetAccount)(nil)} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err := srv.db.NewInsert().Model(&models.SocialSet{ID: "set-1", WorkspaceID: "ws-1", Name: "Saved"}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.SocialSetAccount{
		SocialSetID: "set-1", SocialAccountID: "account-1", DefaultOutputProfile: "x.post",
		DefaultSettingsJSON:        `{"reply_settings":"following","made_with_ai":true}`,
		DefaultSegmentSettingsJSON: `{"poll_options":"Default"}`,
	}).Exec(ctx)
	require.NoError(t, err)
	create := func(reply string) (models.Rendition, models.RenditionSegment) {
		t.Helper()
		input := CreatePublicationBody{
			WorkspaceID: "ws-1", SocialSetID: "set-1", ContentProfile: models.ContentProfileShortText,
			SourceText: "Draft", Renditions: []RenditionInput{{SocialAccountID: "account-1"}},
		}
		if reply != "" {
			input.Renditions[0].Settings = map[string]any{"reply_settings": reply}
			input.Renditions[0].Segments = []RenditionSegmentInput{{Settings: map[string]any{"poll_options": "Custom"}}}
		}
		created, err := srv.handler.publicationHandler().publicationApplication().Create(ctx, "user-1", input)
		require.NoError(t, err)
		var rendition models.Rendition
		require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("publication_id = ?", created.ID).Scan(ctx))
		var segment models.RenditionSegment
		require.NoError(t, srv.db.NewSelect().Model(&segment).Where("rendition_id = ?", rendition.ID).Scan(ctx))
		return rendition, segment
	}
	defaultRendition, defaultSegment := create("")
	require.JSONEq(t, `{"reply_settings":"following","made_with_ai":true}`, defaultRendition.SettingsJSON)
	require.JSONEq(t, `{"poll_options":"Default"}`, defaultSegment.SettingsJSON)
	overriddenRendition, overriddenSegment := create("mentionedUsers")
	require.JSONEq(t, `{"reply_settings":"mentionedUsers","made_with_ai":true}`, overriddenRendition.SettingsJSON)
	require.JSONEq(t, `{"poll_options":"Custom"}`, overriddenSegment.SettingsJSON)
	_, err = srv.db.NewUpdate().Model((*models.SocialSetAccount)(nil)).Set("default_settings_json = ?", `{"reply_settings":"verified"}`).Where("social_set_id = ?", "set-1").Exec(ctx)
	require.NoError(t, err)
	var unchanged models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&unchanged).Where("id = ?", defaultRendition.ID).Scan(ctx))
	require.JSONEq(t, defaultRendition.SettingsJSON, unchanged.SettingsJSON)
}

func TestSocialSetRejectsAnOutputProfileFromAnotherProvider(t *testing.T) {
	server := newSocialSetsTestServer(t)
	response := server.request(t, http.MethodPost, "/api/v1/social-sets", map[string]any{
		"workspace_id": "ws-1",
		"name":         "Invalid",
		"accounts": []map[string]any{
			{"social_account_id": "acc-1", "default_output_profile": "instagram.story"},
		},
	})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
}

func TestDeletingSocialSetDoesNotDeleteSnapshottedRenditions(t *testing.T) {
	server := newSocialSetsTestServer(t)
	ctx := context.Background()
	set := &models.SocialSet{ID: "set-1", WorkspaceID: "ws-1", Name: "Saved"}
	_, err := server.db.NewInsert().Model(set).Exec(ctx)
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Draft",
		Intent: models.PublishingIntentPost, CreationPreset: models.PublishingIntentPost,
		SocialSetID: set.ID, ContentProfile: models.ContentProfileShortText,
		SourceContent: "Draft", SourceText: "Draft", Status: models.PublicationStatusDraft,
		Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", RepostOverride: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "acc-1",
		Platform: "x", Profile: models.ContentProfileShortText, OutputProfile: "x.post",
		SettingsJSON: "{}", Status: models.RenditionStatusDraft,
	}).Exec(ctx)
	require.NoError(t, err)

	response := server.request(t, http.MethodDelete, "/api/v1/social-sets/set-1?confirm=true", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	count, err := server.db.NewSelect().Model((*models.Rendition)(nil)).Where("id = ?", "rendition-1").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

type socialSetsTestServer struct {
	echo *echo.Echo
	db   *bun.DB
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
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewSocialSetHandler(db, testAuthenticator{}).RegisterRoutes(api)
	return &socialSetsTestServer{echo: e, db: db}
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
