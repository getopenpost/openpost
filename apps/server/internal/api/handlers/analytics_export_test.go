package handlers

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/xuri/excelize/v2"
)

func newAnalyticsExportServer(t *testing.T) *echo.Echo {
	e, _ := newAnalyticsExportServerWithDB(t)
	return e
}

func newAnalyticsExportServerWithDB(t *testing.T) (*echo.Echo, *bun.DB) {
	t.Helper()
	db := newAnalyticsHandlerTestDB(t, "ws-1")
	ctx := t.Context()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleViewer}).Exec(ctx)
	require.NoError(t, err)
	for _, account := range []models.SocialAccount{
		{ID: "account-x", WorkspaceID: "ws-1", Slug: "x-account", Platform: "x", AccountID: "x-1", AccountUsername: "@person", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now},
		{ID: "account-yt", WorkspaceID: "ws-1", Slug: "yt-account", Platform: "youtube", AccountID: "yt-1", AccountUsername: "channel", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now},
	} {
		_, err = db.NewInsert().Model(&account).Exec(ctx)
		require.NoError(t, err)
	}
	for index, title := range []string{"=HYPERLINK(\"http://evil\")", "Second post"} {
		id := string(rune('a' + index))
		published := now.Add(-time.Duration(index+1) * 26 * time.Hour)
		_, err = db.NewInsert().Model(&models.Publication{
			ID: "publication-" + id, WorkspaceID: "ws-1", CreatedByID: "user-1", Title: title,
			Intent: "post", ContentProfile: models.ContentProfileShortText, SourceText: title,
			Status: models.PublicationStatusPublished, ActualRunAt: published, CreatedAt: published, UpdatedAt: published,
		}).Exec(ctx)
		require.NoError(t, err)
		accountID, platformName := "account-x", "x"
		if index == 1 {
			accountID, platformName = "account-yt", "youtube"
		}
		_, err = db.NewInsert().Model(&models.Rendition{
			ID: "rendition-" + id, PublicationID: "publication-" + id, TargetKey: "post", SocialAccountID: accountID,
			Platform: platformName, Profile: "short_text", Status: models.RenditionStatusPublished, CreatedAt: published, UpdatedAt: published,
		}).Exec(ctx)
		require.NoError(t, err)
	}

	service := analyticsservice.NewService(db, analyticsHandlerTokenSource{})
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAnalyticsHandler(db, testAuthenticator{}, service).RegisterRoutes(api)
	return e, db
}

func exportRequest(t *testing.T, e *echo.Echo, query string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/analytics/export?workspace_id=ws-1&"+query, nil)
	request.Header.Set("Authorization", "Bearer web-token")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	return response
}

func TestAnalyticsExportWorkbookHasSheetsAndCharts(t *testing.T) {
	t.Parallel()
	e := newAnalyticsExportServer(t)

	response := exportRequest(t, e, "format=xlsx&group_by=day&timezone=America/New_York")
	require.Equal(t, http.StatusOK, response.Code)
	file, err := excelize.OpenReader(bytes.NewReader(response.Body.Bytes()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = file.Close() })
	require.Equal(t, []string{"Summary", "ByDay", "Posts", "Daily", "Accounts"}, file.GetSheetList())
	archive, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	require.NoError(t, err)
	charts := 0
	for _, entry := range archive.File {
		if strings.HasPrefix(entry.Name, "xl/charts/chart") {
			charts++
		}
	}
	require.Equal(t, 1, charts, "the grouped chart; the daily chart needs snapshots")
	timezone, err := file.GetCellValue("Summary", "B3")
	require.NoError(t, err)
	require.Equal(t, "America/New_York", timezone)
}

func TestAnalyticsExportIncludesEveryPageOfContent(t *testing.T) {
	t.Parallel()
	e, db := newAnalyticsExportServerWithDB(t)
	now := time.Now().UTC()
	extra := make([]models.Rendition, 0, 130)
	for index := range 130 {
		extra = append(extra, models.Rendition{
			ID: fmt.Sprintf("extra-%03d", index), PublicationID: "publication-a", TargetKey: fmt.Sprintf("extra-%d", index),
			SocialAccountID: "account-x", Platform: "x", Profile: "short_text",
			Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now,
		})
	}
	_, err := db.NewInsert().Model(&extra).Exec(t.Context())
	require.NoError(t, err)

	response := exportRequest(t, e, "format=csv&dataset=posts")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(response.Body.String(), string([]byte{0xEF, 0xBB, 0xBF})))).ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, 1+2+130, "header, the two seeded posts, and every extra output past the first 100-row page")
}
