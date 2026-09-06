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
			{"social_account_id": "acc-1", "default_output_profile": "x.thread"},
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

	response = server.request(t, http.MethodGet, "/api/v1/social-sets?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var listed []SocialSetResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	require.Equal(t, created.ID, listed[0].ID)
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
