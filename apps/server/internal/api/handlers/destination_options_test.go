package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	telegramservice "github.com/openpost/backend/internal/services/telegram"
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

func TestTelegramPublishingOptionsOnlyExposeTheVerifiedAccountChat(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.TelegramConnection)(nil))
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)
	for _, entry := range []struct {
		id, chatID, connectedChatID, title string
	}{
		{"telegram-1", "-100111", "-100111", "Launches"},
		{"telegram-2", "-100222", "-100222", "Private team"},
		{"telegram-3", "-100333", "-100444", "Wrong installation"},
	} {
		_, err = db.NewInsert().Model(&models.SocialAccount{
			ID: entry.id, WorkspaceID: "ws-1", Platform: "telegram", AccountID: entry.chatID,
			AccountUsername: entry.title, AccessTokenEnc: []byte{}, IsActive: true,
		}).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.TelegramConnection{
			SocialAccountID: entry.id, WorkspaceID: "ws-1", ChatID: entry.connectedChatID, ChatType: "channel",
			InstalledAt: now, CoverageStartedAt: now, CoverageKind: "since_installation",
			PermissionsVerifiedAt: now, CreatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, err)
	}

	tokenSource := &destinationOptionsTokenSource{}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewDestinationOptionsHandler(db, testAuthenticator{}, nil, tokenSource)
	handler.SetTelegramChatOptions(telegramservice.NewService(db, nil, "openpost_bot", "secret"))
	handler.RegisterRoutes(api)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/v1/accounts/telegram-1/publishing-options/telegram_chats", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var output struct {
		Options []platform.DestinationOption `json:"options"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &output))
	require.Equal(t, []platform.DestinationOption{{Value: "-100111", Label: "Launches"}}, output.Options)
	require.Empty(t, tokenSource.accountID, "Telegram options must use the installation, not user OAuth")

	otherReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/v1/accounts/telegram-2/publishing-options/telegram_chats", nil)
	otherReq.Header.Set("Authorization", "Bearer web-token")
	otherRec := httptest.NewRecorder()
	e.ServeHTTP(otherRec, otherReq)
	require.Equal(t, http.StatusOK, otherRec.Code, otherRec.Body.String())
	require.NoError(t, json.Unmarshal(otherRec.Body.Bytes(), &output))
	require.Equal(t, []platform.DestinationOption{{Value: "-100222", Label: "Private team"}}, output.Options)

	legacyReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/v1/accounts/telegram-1/destination-options", nil)
	legacyReq.Header.Set("Authorization", "Bearer web-token")
	legacyRec := httptest.NewRecorder()
	e.ServeHTTP(legacyRec, legacyReq)
	require.Equal(t, http.StatusOK, legacyRec.Code, legacyRec.Body.String())
	var legacyOutput struct {
		Options map[string][]platform.DestinationOption `json:"options"`
	}
	require.NoError(t, json.Unmarshal(legacyRec.Body.Bytes(), &legacyOutput))
	require.Equal(t, []platform.DestinationOption{{Value: "-100111", Label: "Launches"}},
		legacyOutput.Options["telegram_chats"])

	mismatchedReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/v1/accounts/telegram-3/publishing-options/telegram_chats", nil)
	mismatchedReq.Header.Set("Authorization", "Bearer web-token")
	mismatchedRec := httptest.NewRecorder()
	e.ServeHTTP(mismatchedRec, mismatchedReq)
	require.Equal(t, http.StatusOK, mismatchedRec.Code, mismatchedRec.Body.String())
	require.NoError(t, json.Unmarshal(mismatchedRec.Body.Bytes(), &output))
	require.Empty(t, output.Options)

	searchReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/v1/accounts/telegram-1/publishing-options/telegram_chats?search=Private", nil)
	searchReq.Header.Set("Authorization", "Bearer web-token")
	searchRec := httptest.NewRecorder()
	e.ServeHTTP(searchRec, searchReq)
	require.Equal(t, http.StatusOK, searchRec.Code, searchRec.Body.String())
	require.NoError(t, json.Unmarshal(searchRec.Body.Bytes(), &output))
	require.Empty(t, output.Options)

	_, err = db.NewUpdate().Model((*models.TelegramConnection)(nil)).
		Set("permissions_verified_at = ?", time.Time{}).
		Where("social_account_id = ?", "telegram-1").Exec(t.Context())
	require.NoError(t, err)
	unverifiedReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"/api/v1/accounts/telegram-1/publishing-options/telegram_chats", nil)
	unverifiedReq.Header.Set("Authorization", "Bearer web-token")
	unverifiedRec := httptest.NewRecorder()
	e.ServeHTTP(unverifiedRec, unverifiedReq)
	require.Equal(t, http.StatusOK, unverifiedRec.Code, unverifiedRec.Body.String())
	require.NoError(t, json.Unmarshal(unverifiedRec.Body.Bytes(), &output))
	require.Empty(t, output.Options)
}
