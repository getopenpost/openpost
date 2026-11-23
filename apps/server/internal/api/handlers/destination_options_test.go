package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"

	"github.com/stretchr/testify/require"
)

type destinationOptionsTestAdapter struct {
	platform.Adapter
	input       platform.DestinationOptionsInput
	searchInput platform.PublishingOptionsInput
	token       string
}

func (a *destinationOptionsTestAdapter) ListDestinationOptions(_ context.Context, accessToken string, input platform.DestinationOptionsInput) (map[string][]platform.DestinationOption, error) {
	a.token = accessToken
	a.input = input
	return map[string][]platform.DestinationOption{
		"youtube_playlists": {{Value: "playlist-1", Label: "Product videos"}},
	}, nil
}

func (a *destinationOptionsTestAdapter) SearchPublishingOptions(_ context.Context, accessToken string, input platform.PublishingOptionsInput) (platform.PublishingOptionsPage, error) {
	a.token = accessToken
	a.searchInput = input
	return platform.PublishingOptionsPage{
		Options:    []platform.DestinationOption{{Value: "playlist-2", Label: "Lisbon launches"}},
		NextCursor: "next-page",
	}, nil
}

type destinationOptionsTokenSource struct {
	accountID string
}

func (s *destinationOptionsTokenSource) GetValidAccessToken(_ context.Context, accountID string) (string, error) {
	s.accountID = accountID
	return "valid-access-token", nil
}

func TestDestinationOptionsUsesDynamicallyRegisteredInstanceAdapter(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "lemmy-1",
		WorkspaceID:    "ws-1",
		Slug:           "lemmy-main",
		Platform:       "lemmy",
		InstanceURL:    "https://lemmy.example",
		AccessTokenEnc: []byte("encrypted"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)

	adapter := &destinationOptionsTestAdapter{}
	tokenSource := &destinationOptionsTokenSource{}
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewDestinationOptionsHandler(db, testAuthenticator{}, map[string]platform.Adapter{
		"lemmy": platform.NewLemmyAdapter(""),
	}, tokenSource)
	handler.SetProvider(platform.AccountProviderKey("lemmy", "https://lemmy.example", ""), adapter)
	handler.RegisterRoutes(api)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/v1/accounts/lemmy-1/publishing-options/lemmy_communities", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var output struct {
		Options []platform.DestinationOption `json:"options"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &output))
	require.Equal(t, []platform.DestinationOption{{Value: "playlist-2", Label: "Lisbon launches"}}, output.Options)
	require.Equal(t, "lemmy-1", tokenSource.accountID)
}
