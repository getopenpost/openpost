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

func TestDestinationOptionsUsesConnectedAccountAndFreshToken(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "youtube-1",
		WorkspaceID:    "ws-1",
		Slug:           "youtube-main",
		Platform:       "youtube",
		AccountID:      "channel-1",
		AccessTokenEnc: []byte("encrypted"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)

	adapter := &destinationOptionsTestAdapter{}
	tokenSource := &destinationOptionsTokenSource{}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewDestinationOptionsHandler(db, testAuthenticator{}, map[string]platform.Adapter{
		"youtube": adapter,
	}, tokenSource).RegisterRoutes(api)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/accounts/youtube-1/destination-options?region_code=PT&language=pt", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var output struct {
		Options map[string][]platform.DestinationOption `json:"options"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &output))
	require.Equal(t, []platform.DestinationOption{{Value: "playlist-1", Label: "Product videos"}}, output.Options["youtube_playlists"])
	require.Equal(t, "youtube-1", tokenSource.accountID)
	require.Equal(t, "valid-access-token", adapter.token)
	require.Equal(t, platform.DestinationOptionsInput{RegionCode: "PT", Language: "pt"}, adapter.input)
}

func TestPublishingOptionsForwardsSearchPaginationAndContext(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "youtube-1",
		WorkspaceID:    "ws-1",
		Slug:           "youtube-main",
		Platform:       "youtube",
		AccountID:      "channel-1",
		AccessTokenEnc: []byte("encrypted"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)

	adapter := &destinationOptionsTestAdapter{}
	tokenSource := &destinationOptionsTokenSource{}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewDestinationOptionsHandler(db, testAuthenticator{}, map[string]platform.Adapter{
		"youtube": adapter,
	}, tokenSource).RegisterRoutes(api)

	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/api/v1/accounts/youtube-1/publishing-options/youtube_playlists?search=Lisbon&locale=pt-PT&region=PT&cursor=opaque&context=youtube.short&limit=12",
		nil,
	)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var output struct {
		Options    []platform.DestinationOption `json:"options"`
		NextCursor string                       `json:"next_cursor"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &output))
	require.Equal(t, []platform.DestinationOption{{Value: "playlist-2", Label: "Lisbon launches"}}, output.Options)
	require.Equal(t, "next-page", output.NextCursor)
	require.Equal(t, platform.PublishingOptionsInput{
		Source:     "youtube_playlists",
		Search:     "Lisbon",
		Locale:     "pt-PT",
		RegionCode: "PT",
		Cursor:     "opaque",
		Context:    map[string]string{"value": "youtube.short"},
		Limit:      12,
	}, adapter.searchInput)
	require.Equal(t, "valid-access-token", adapter.token)
}

func TestThreadsLocationOptionsRequireLocationTaggingScope(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "threads-1",
		WorkspaceID:    "ws-1",
		Slug:           "threads-main",
		Platform:       "threads",
		AccountID:      "threads-user-1",
		AccessTokenEnc: []byte("encrypted"),
		GrantedScopes:  "threads_basic threads_content_publish",
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)

	adapter := &destinationOptionsTestAdapter{}
	tokenSource := &destinationOptionsTokenSource{}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewDestinationOptionsHandler(db, testAuthenticator{}, map[string]platform.Adapter{
		"threads": adapter,
	}, tokenSource).RegisterRoutes(api)

	emptyReq := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/api/v1/accounts/threads-1/publishing-options/threads_locations?search=",
		nil,
	)
	emptyReq.Header.Set("Authorization", "Bearer web-token")
	emptyRec := httptest.NewRecorder()
	e.ServeHTTP(emptyRec, emptyReq)
	require.Equal(t, http.StatusOK, emptyRec.Code, emptyRec.Body.String())
	var emptyOutput struct {
		Options []platform.DestinationOption `json:"options"`
	}
	require.NoError(t, json.Unmarshal(emptyRec.Body.Bytes(), &emptyOutput))
	require.Empty(t, emptyOutput.Options)
	require.Empty(t, tokenSource.accountID)

	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/api/v1/accounts/threads-1/publishing-options/threads_locations?search=Lisbon",
		nil,
	)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "Reconnect this Threads account")
	require.Empty(t, tokenSource.accountID)
	require.Empty(t, adapter.token)
}
