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

	body := bytes.NewBufferString(`{"workspace_id":"ws-1"}`)
	refreshRequest := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/analytics/refresh", body)
	refreshRequest.Header.Set("Authorization", "Bearer web-token")
	refreshRequest.Header.Set("Content-Type", "application/json")
	refreshResponse := httptest.NewRecorder()
	e.ServeHTTP(refreshResponse, refreshRequest)
	require.Equal(t, http.StatusForbidden, refreshResponse.Code, refreshResponse.Body.String())
}
