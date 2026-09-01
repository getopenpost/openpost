package handlers

import (
	"bytes"
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
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/stretchr/testify/require"
)

type analyticsHandlerAdapter struct {
	platform.Adapter
}

func (analyticsHandlerAdapter) AnalyticsSupport() platform.AnalyticsSupport {
	return platform.AnalyticsSupport{Account: true}
}

func (analyticsHandlerAdapter) FetchAccountAnalytics(context.Context, string, platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	return platform.AnalyticsValues{platform.MetricFollowers: 10}, nil
}

func (analyticsHandlerAdapter) FetchContentAnalytics(context.Context, string, platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	return nil, platform.NewAnalyticsError(platform.AnalyticsStatusUnsupported, "content")
}

type analyticsHandlerTokenSource struct{}

func (analyticsHandlerTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

func TestAnalyticsContentReferenceOpenAPISchemaIsDiscriminatedOneOf(t *testing.T) {
	db := newHandlerSchemaTestDB(t)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAnalyticsHandler(db, testAuthenticator{}, analyticsservice.NewService(db, analyticsHandlerTokenSource{})).RegisterRoutes(api)
	encoded, err := json.Marshal(api.OpenAPI())
	require.NoError(t, err)
	var document map[string]any
	require.NoError(t, json.Unmarshal(encoded, &document))
	components := document["components"].(map[string]any)
	schemas := components["schemas"].(map[string]any)
	reference := schemas["ContentReference"].(map[string]any)
	require.Len(t, reference["oneOf"].([]any), 2)
	discriminator := reference["discriminator"].(map[string]any)
	require.Equal(t, "type", discriminator["propertyName"])
}

func TestAnalyticsOverviewRejectsCursorFromAnotherSource(t *testing.T) {
	db := createHandlerTestDB(
		t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.AnalyticsAccountSnapshot)(nil),
		(*models.AnalyticsRenditionSnapshot)(nil),
		(*models.AnalyticsAccountContentSnapshot)(nil),
		(*models.AccountContent)(nil),
		(*models.AccountContentDiscoveryState)(nil),
		(*models.AnalyticsSyncState)(nil),
	)
	ctx := t.Context()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleViewer}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "ws-1", Slug: "youtube-account", Platform: "youtube",
		AccountID: "channel-1", AccountUsername: "person", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	contents := []models.AccountContent{
		{ID: "external-1", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "youtube", ProviderContentID: "video-1", ContentProfile: models.ContentProfileLongVideo, Text: "one", PublishedAt: now.Add(-time.Hour), Origin: string(platform.AccountContentOriginExternal), OriginConfidence: string(platform.AccountContentOriginConfidenceExact), FirstDiscoveredAt: now, LastSeenAt: now, CreatedAt: now, UpdatedAt: now},
		{ID: "external-2", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "youtube", ProviderContentID: "video-2", ContentProfile: models.ContentProfileLongVideo, Text: "two", PublishedAt: now.Add(-2 * time.Hour), Origin: string(platform.AccountContentOriginExternal), OriginConfidence: string(platform.AccountContentOriginConfidenceExact), FirstDiscoveredAt: now, LastSeenAt: now, CreatedAt: now, UpdatedAt: now},
	}
	_, err = db.NewInsert().Model(&contents).Exec(ctx)
	require.NoError(t, err)

	service := analyticsservice.NewService(db, analyticsHandlerTokenSource{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAnalyticsHandler(db, testAuthenticator{}, service).RegisterRoutes(api)

	firstRequest := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=ws-1&days=30&source=external&limit=1", nil)
	firstRequest.Header.Set("Authorization", "Bearer web-token")
	firstResponse := httptest.NewRecorder()
	e.ServeHTTP(firstResponse, firstRequest)
	require.Equal(t, http.StatusOK, firstResponse.Code, firstResponse.Body.String())
	var first analyticsservice.Overview
	require.NoError(t, json.Unmarshal(firstResponse.Body.Bytes(), &first))
	require.NotEmpty(t, first.ContentNextCursor)

	mismatchRequest := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=ws-1&days=30&source=all&limit=1&cursor="+first.ContentNextCursor, nil)
	mismatchRequest.Header.Set("Authorization", "Bearer web-token")
	mismatchResponse := httptest.NewRecorder()
	e.ServeHTTP(mismatchResponse, mismatchRequest)
	require.Equal(t, http.StatusBadRequest, mismatchResponse.Code, mismatchResponse.Body.String())

	inserted := contents[0]
	inserted.ID, inserted.ProviderContentID, inserted.Text = "external-3", "video-3", "inserted"
	inserted.PublishedAt = now.Add(-30 * time.Minute)
	_, err = db.NewInsert().Model(&inserted).Exec(ctx)
	require.NoError(t, err)
	insertedRequest := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=ws-1&days=30&source=external&limit=1&cursor="+first.ContentNextCursor, nil)
	insertedRequest.Header.Set("Authorization", "Bearer web-token")
	insertedResponse := httptest.NewRecorder()
	e.ServeHTTP(insertedResponse, insertedRequest)
	require.Equal(t, http.StatusBadRequest, insertedResponse.Code, insertedResponse.Body.String())

	freshRequest := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=ws-1&days=30&source=external&limit=1", nil)
	freshRequest.Header.Set("Authorization", "Bearer web-token")
	freshResponse := httptest.NewRecorder()
	e.ServeHTTP(freshResponse, freshRequest)
	require.Equal(t, http.StatusOK, freshResponse.Code)
	var fresh analyticsservice.Overview
	require.NoError(t, json.Unmarshal(freshResponse.Body.Bytes(), &fresh))
	_, err = db.NewUpdate().Model((*models.AccountContent)(nil)).Set("published_at = ?", now.Add(time.Minute)).Where("id = ?", "external-2").Exec(ctx)
	require.NoError(t, err)
	reorderedRequest := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=ws-1&days=30&source=external&limit=1&cursor="+fresh.ContentNextCursor, nil)
	reorderedRequest.Header.Set("Authorization", "Bearer web-token")
	reorderedResponse := httptest.NewRecorder()
	e.ServeHTTP(reorderedResponse, reorderedRequest)
	require.Equal(t, http.StatusBadRequest, reorderedResponse.Code, reorderedResponse.Body.String())

	tampered := fresh.ContentNextCursor[:len(fresh.ContentNextCursor)-1] + "x"
	tamperedRequest := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=ws-1&days=30&source=external&limit=1&cursor="+tampered, nil)
	tamperedRequest.Header.Set("Authorization", "Bearer web-token")
	tamperedResponse := httptest.NewRecorder()
	e.ServeHTTP(tamperedResponse, tamperedRequest)
	require.Equal(t, http.StatusBadRequest, tamperedResponse.Code, tamperedResponse.Body.String())
}

func TestAnalyticsRepurposeRequiresEditorAndKeepsOpaqueReferencesWorkspaceScoped(t *testing.T) {
	db := createHandlerTestDB(
		t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.AnalyticsRenditionSnapshot)(nil),
		(*models.AnalyticsAccountContentSnapshot)(nil),
		(*models.AccountContent)(nil),
	)
	ctx := t.Context()
	now := time.Now().UTC()
	member := models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleViewer}
	_, err := db.NewInsert().Model(&member).Exec(ctx)
	require.NoError(t, err)
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "ws-1", Slug: "x-account", Platform: "x", AccountID: "provider-account",
		AccountUsername: "person", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now,
	}
	_, err = db.NewInsert().Model(&account).Exec(ctx)
	require.NoError(t, err)
	content := models.AccountContent{
		ID: "external-1", WorkspaceID: "ws-1", SocialAccountID: account.ID, Platform: account.Platform,
		ProviderContentID: "provider-secret", ContentProfile: models.ContentProfileShortText,
		Title: "A useful lesson", Text: "Stored source text", PublishedAt: now.Add(-time.Hour),
		Origin: string(platform.AccountContentOriginExternal), OriginConfidence: string(platform.AccountContentOriginConfidenceExact),
		FirstDiscoveredAt: now, LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(&content).Exec(ctx)
	require.NoError(t, err)
	service := analyticsservice.NewService(db, analyticsHandlerTokenSource{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAnalyticsHandler(db, testAuthenticator{}, service).RegisterRoutes(api)

	invoke := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/analytics/repurpose", bytes.NewBufferString(body))
		request.Header.Set("Authorization", "Bearer web-token")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		return response
	}
	body := `{"workspace_id":"ws-1","reference":{"type":"external","account_content_id":"external-1"},"range":{"days":30}}`
	require.Equal(t, http.StatusForbidden, invoke(body).Code, "viewers cannot prepare repurpose state")
	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleEditor).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").Exec(ctx)
	require.NoError(t, err)

	forged := `{"workspace_id":"ws-1","reference":{"type":"external","account_content_id":"forged-provider-secret"},"range":{"days":30}}`
	require.Equal(t, http.StatusNotFound, invoke(forged).Code)
	crossWorkspace := `{"workspace_id":"another-workspace","reference":{"type":"external","account_content_id":"external-1"},"range":{"days":30}}`
	require.Equal(t, http.StatusForbidden, invoke(crossWorkspace).Code)

	response := invoke(body)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var handoff analyticsservice.RepurposeSource
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &handoff))
	require.Equal(t, "Stored source text", handoff.SourceText)
	require.NotEmpty(t, handoff.HandoffID)
	require.NotContains(t, response.Body.String(), "provider-secret")
}

func TestAnalyticsOverviewAllowsViewerButRefreshRequiresEditor(t *testing.T) {
	db := createHandlerTestDB(
		t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.AnalyticsAccountSnapshot)(nil),
		(*models.AnalyticsRenditionSnapshot)(nil),
		(*models.AnalyticsAccountContentSnapshot)(nil),
		(*models.AccountContent)(nil),
		(*models.AccountContentDiscoveryState)(nil),
		(*models.AnalyticsSyncState)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleViewer,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:              "account-1",
		WorkspaceID:     "ws-1",
		Slug:            "x-account",
		Platform:        "x",
		AccountID:       "x-user",
		AccountUsername: "@person",
		AccessTokenEnc:  []byte("encrypted"),
		IsActive:        true,
		CreatedAt:       time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AnalyticsSyncState{
		ID:              "account:account-1",
		WorkspaceID:     "ws-1",
		SubjectType:     "account",
		SubjectID:       "account-1",
		SocialAccountID: "account-1",
		Platform:        "x",
		Status:          string(platform.AnalyticsStatusOK),
		MetricsJSON:     `{"followers":10}`,
		LastSuccessAt:   time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	service := analyticsservice.NewService(db, analyticsHandlerTokenSource{})
	service.SetProvider("x", analyticsHandlerAdapter{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAnalyticsHandler(db, testAuthenticator{}, service).RegisterRoutes(api)

	getRequest := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=ws-1&days=30", nil)
	getRequest.Header.Set("Authorization", "Bearer web-token")
	getResponse := httptest.NewRecorder()
	e.ServeHTTP(getResponse, getRequest)
	require.Equal(t, http.StatusOK, getResponse.Code, getResponse.Body.String())
	var overview analyticsservice.Overview
	require.NoError(t, json.Unmarshal(getResponse.Body.Bytes(), &overview))
	require.Len(t, overview.Accounts, 1)
	require.Equal(t, int64(10), overview.Summary.Followers.Value)
	require.Equal(t, platform.AnalyticsMetricUnitCount, overview.Accounts[0].MetricMetadata[platform.MetricFollowers].Unit)
	require.Equal(t, platform.AnalyticsMetricAggregationCurrentSnapshot, overview.Accounts[0].MetricMetadata[platform.MetricFollowers].Aggregation)
	require.Equal(t, "x", overview.Accounts[0].MetricMetadata[platform.MetricFollowers].Source)

	body := bytes.NewBufferString(`{"workspace_id":"ws-1"}`)
	refreshRequest := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/analytics/refresh", body)
	refreshRequest.Header.Set("Authorization", "Bearer web-token")
	refreshRequest.Header.Set("Content-Type", "application/json")
	refreshResponse := httptest.NewRecorder()
	e.ServeHTTP(refreshResponse, refreshRequest)
	require.Equal(t, http.StatusForbidden, refreshResponse.Code, refreshResponse.Body.String())
}
