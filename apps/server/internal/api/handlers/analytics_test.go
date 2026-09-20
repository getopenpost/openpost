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

func TestAnalyticsOverviewRejectsStaleCursor(t *testing.T) {
	db := createHandlerTestDB(
		t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.AnalyticsAccountSnapshot)(nil),
		(*models.AnalyticsRenditionSnapshot)(nil),
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
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Launch",
		Intent: "post", ContentProfile: models.ContentProfileShortText, SourceText: "Launch",
		Status: models.PublicationStatusPublished, ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)
	renditions := []models.Rendition{
		{ID: "rendition-1", PublicationID: "publication-1", TargetKey: "post", SocialAccountID: "account-1", Platform: "youtube", Profile: "short_video", Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now},
		{ID: "rendition-2", PublicationID: "publication-1", TargetKey: "post", SocialAccountID: "account-1", Platform: "youtube", Profile: "short_video", Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now},
	}
	_, err = db.NewInsert().Model(&renditions).Exec(ctx)
	require.NoError(t, err)

	service := analyticsservice.NewService(db, analyticsHandlerTokenSource{})
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAnalyticsHandler(db, testAuthenticator{}, service).RegisterRoutes(api)

	get := func(query string) *httptest.ResponseRecorder {
		request := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics"+query, nil)
		request.Header.Set("Authorization", "Bearer web-token")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		return response
	}

	firstResponse := get("?workspace_id=ws-1&days=30&limit=1")
	require.Equal(t, http.StatusOK, firstResponse.Code, firstResponse.Body.String())
	var first analyticsservice.Overview
	require.NoError(t, json.Unmarshal(firstResponse.Body.Bytes(), &first))
	require.NotEmpty(t, first.ContentNextCursor)
	require.Len(t, first.Content, 1)

	mismatchResponse := get("?workspace_id=ws-1&days=30&limit=1&account_id=account-2&cursor=" + first.ContentNextCursor)
	require.Equal(t, http.StatusBadRequest, mismatchResponse.Code, mismatchResponse.Body.String())

	inserted := renditions[0]
	inserted.ID = "rendition-3"
	_, err = db.NewInsert().Model(&inserted).Exec(ctx)
	require.NoError(t, err)
	insertedResponse := get("?workspace_id=ws-1&days=30&limit=1&cursor=" + first.ContentNextCursor)
	require.Equal(t, http.StatusBadRequest, insertedResponse.Code, insertedResponse.Body.String())

	tampered := first.ContentNextCursor[:len(first.ContentNextCursor)-1] + "x"
	tamperedResponse := get("?workspace_id=ws-1&days=30&limit=1&cursor=" + tampered)
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
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "A useful lesson",
		Intent: "post", ContentProfile: models.ContentProfileShortText, SourceText: "Stored source text",
		Status: models.PublicationStatusPublished, ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", TargetKey: "post", SocialAccountID: account.ID,
		Platform: account.Platform, Profile: "short_text", Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
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
	body := `{"workspace_id":"ws-1","reference":{"type":"openpost","publication_id":"publication-1","rendition_id":"rendition-1"},"range":{"days":30}}`
	require.Equal(t, http.StatusForbidden, invoke(body).Code, "viewers cannot prepare repurpose state")
	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleEditor).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").Exec(ctx)
	require.NoError(t, err)

	forged := `{"workspace_id":"ws-1","reference":{"type":"openpost","publication_id":"publication-1","rendition_id":"forged-rendition"},"range":{"days":30}}`
	require.Equal(t, http.StatusNotFound, invoke(forged).Code)
	crossWorkspace := `{"workspace_id":"another-workspace","reference":{"type":"openpost","publication_id":"publication-1","rendition_id":"rendition-1"},"range":{"days":30}}`
	require.Equal(t, http.StatusForbidden, invoke(crossWorkspace).Code)

	response := invoke(body)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var handoff analyticsservice.RepurposeSource
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &handoff))
	require.Equal(t, "Stored source text", handoff.SourceText)
	require.NotEmpty(t, handoff.HandoffID)
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
