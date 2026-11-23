package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"

	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type analyticsHandlerTokenSource struct{}

func (analyticsHandlerTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

func TestAnalyticsRepurposeRequiresEditorAndKeepsOpaqueReferencesWorkspaceScoped(t *testing.T) {
	t.Parallel()
	db := newAnalyticsHandlerTestDB(t, "ws-1")
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
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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

func TestAnalyticsOverviewFiltersSeveralAccountsAndBindsCursorToTheSet(t *testing.T) {
	t.Parallel()
	db := newAnalyticsHandlerTestDB(t, "selected", "other")
	ctx := t.Context()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "selected", UserID: "user-1", Role: models.WorkspaceRoleViewer}).Exec(ctx)
	require.NoError(t, err)
	for i, id := range []string{"a", "b", "c", "foreign"} {
		workspace := "selected"
		if id == "foreign" {
			workspace = "other"
		}
		account := models.SocialAccount{ID: id, WorkspaceID: workspace, Slug: id, Platform: "youtube", AccountID: id, AccountUsername: id, AccessTokenEnc: []byte("fixture"), IsActive: true}
		publication := models.Publication{ID: id, WorkspaceID: workspace, CreatedByID: "user-1", Intent: "post", ContentProfile: models.ContentProfileShortText, SourceText: id, Status: models.PublicationStatusPublished, ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour)}
		rendition := models.Rendition{ID: id, PublicationID: id, SocialAccountID: id, Platform: "youtube", Status: models.RenditionStatusPublished}
		state := models.AnalyticsSyncState{ID: "account:" + id, WorkspaceID: workspace, SubjectType: "account", SubjectID: id, SocialAccountID: id, Platform: "youtube", Status: "ok", MetricsJSON: fmt.Sprintf(`{"followers":%d}`, 10*(i+1)), LastSuccessAt: now}
		contentState := models.AnalyticsSyncState{ID: "rendition:" + id, WorkspaceID: workspace, SubjectType: "rendition", SubjectID: id, SocialAccountID: id, Platform: "youtube", Status: "ok", MetricsJSON: fmt.Sprintf(`{"views":%d}`, 100*(i+1)), LastSuccessAt: now}
		for _, row := range []any{&account, &publication, &rendition, &state, &contentState} {
			_, err = db.NewInsert().Model(row).Exec(ctx)
			require.NoError(t, err)
		}
		for n, captured := range []time.Time{now.Add(-26 * time.Hour), now.Add(-time.Minute)} {
			snapshot := models.AnalyticsAccountSnapshot{ID: fmt.Sprintf("%s-%d", id, n), WorkspaceID: workspace, SocialAccountID: id, Platform: "youtube", MetricsJSON: fmt.Sprintf(`{"followers":%d}`, 10*(i+1)+n), CapturedAt: captured}
			_, err = db.NewInsert().Model(&snapshot).Exec(ctx)
			require.NoError(t, err)
			contentSnapshot := models.AnalyticsRenditionSnapshot{ID: snapshot.ID, WorkspaceID: workspace, PublicationID: id, RenditionID: id, SocialAccountID: id, Platform: "youtube", MetricsJSON: fmt.Sprintf(`{"views":%d}`, (90+10*n)*(i+1)), CapturedAt: captured}
			_, err = db.NewInsert().Model(&contentSnapshot).Exec(ctx)
			require.NoError(t, err)
		}
	}
	service := analyticsservice.NewService(db, analyticsHandlerTokenSource{})
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAnalyticsHandler(db, testAuthenticator{}, service).RegisterRoutes(api)
	get := func(query string) (analyticsservice.Overview, int) {
		request := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/analytics?workspace_id=selected&days=30&sort=visibility&"+query, nil)
		request.Header.Set("Authorization", "Bearer web-token")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		var overview analyticsservice.Overview
		if response.Code == http.StatusOK {
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &overview))
		}
		return overview, response.Code
	}
	first, status := get("account_ids=b,a,b&limit=1")
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, 2, first.ContentTotal)
	require.Len(t, first.Accounts, 3, "selector retains all authorized accounts")
	require.Equal(t, analyticsservice.MetricSummary{Value: 300, Measured: 2}, first.Summary.Visibility)
	require.Equal(t, int64(30), first.Summary.Followers.Value)
	require.Equal(t, 2, first.Summary.Followers.Measured)
	require.NotEmpty(t, first.ContentNextCursor)
	second, status := get("account_id=a&account_ids=b&limit=1&cursor=" + url.QueryEscape(first.ContentNextCursor))
	require.Equal(t, http.StatusOK, status, "legacy and multi selection are a normalized union")
	require.Len(t, second.Content, 1)
	require.ElementsMatch(t, []string{"a", "b"}, []string{first.Content[0].AccountID, second.Content[0].AccountID})
	require.Len(t, first.Performance, 2)
	require.Len(t, first.Highlights, 2)
	require.NotEmpty(t, first.FollowerSeries)
	require.Equal(t, int64(32), first.FollowerSeries[len(first.FollowerSeries)-1].Value)
	require.NotEmpty(t, first.Trends.Followers)
	require.Equal(t, int64(2), first.Trends.Followers[len(first.Trends.Followers)-1].Value)
	require.NotEmpty(t, first.Trends.Visibility)
	require.Equal(t, int64(30), first.Trends.Visibility[len(first.Trends.Visibility)-1].Value)
	exported, err := service.BuildExport(ctx, "selected", analyticsservice.ExportOptions{Days: 30, AccountID: "a", AccountIDs: []string{"b", "a"}, Metrics: []string{"visibility"}})
	require.NoError(t, err)
	require.Len(t, exported.Posts.Rows, 2)
	require.Len(t, exported.Accounts.Rows, 2)
	_, status = get("account_ids=a,c&limit=1&cursor=" + url.QueryEscape(first.ContentNextCursor))
	require.Equal(t, http.StatusBadRequest, status, "cursor cannot move to another selected set")
	foreign, status := get("account_ids=foreign")
	require.Equal(t, http.StatusOK, status)
	require.Zero(t, foreign.ContentTotal)
	require.Zero(t, foreign.Summary.Followers.Measured)
	require.Empty(t, foreign.Performance)
	require.Empty(t, foreign.FollowerSeries)
}

// Analytics reports read through retention owners, so endpoint fixtures use the
// production schema rather than a partial table list that can bypass cleanup.
func newAnalyticsHandlerTestDB(t *testing.T, workspaceIDs ...string) *bun.DB {
	t.Helper()
	db := testdb.NewSQLite(t)
	for _, model := range []any{&models.User{ID: "user-1", Email: "analytics@example.com"}, &models.Organization{ID: "analytics-org", Name: "Analytics"}} {
		_, err := db.NewInsert().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	for _, id := range workspaceIDs {
		_, err := db.NewInsert().Model(&models.Workspace{ID: id, OrganizationID: "analytics-org", Name: id}).Exec(t.Context())
		require.NoError(t, err)
	}
	return db
}
