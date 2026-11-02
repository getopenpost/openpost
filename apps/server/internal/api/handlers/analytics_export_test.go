package handlers

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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

func TestAnalyticsExportCSVGroupsByPlatformAndNeutralizesFormulas(t *testing.T) {
	e, db := newAnalyticsExportServerWithDB(t)

	grouped := exportRequest(t, e, "format=csv&group_by=platform&timezone=Europe/Rome")
	require.Equal(t, http.StatusOK, grouped.Code, grouped.Body.String())
	require.Contains(t, grouped.Header().Get("Content-Type"), "text/csv")
	require.Contains(t, grouped.Header().Get("Content-Disposition"), "openpost-analytics-platform-")
	body := strings.TrimPrefix(grouped.Body.String(), string([]byte{0xEF, 0xBB, 0xBF}))
	require.True(t, strings.HasPrefix(body, "Platform,Posts,Engagement"), body)
	require.Contains(t, body, "x,1,")
	require.Contains(t, body, "youtube,1,")

	posts := exportRequest(t, e, "format=csv&dataset=posts")
	require.Equal(t, http.StatusOK, posts.Code, posts.Body.String())
	require.Contains(t, posts.Body.String(), "'=HYPERLINK")
	require.NotContains(t, posts.Body.String(), ",=HYPERLINK")
	require.Contains(t, posts.Body.String(), ",@person,", "plain handles stay intact")

	filtered := exportRequest(t, e, "format=csv&dataset=posts&platforms=youtube")
	require.Equal(t, http.StatusOK, filtered.Code, filtered.Body.String())
	require.NotContains(t, filtered.Body.String(), "HYPERLINK")
	require.Contains(t, filtered.Body.String(), "Second post")
	for _, prefix := range []string{"\n", "＝", "＋", "－", "＠"} {
		t.Run(fmt.Sprintf("prefix_%U", []rune(prefix)[0]), func(t *testing.T) {
			title := prefix + "=1+1"
			_, err := db.NewUpdate().Model((*models.Publication)(nil)).Set("title = ?", title).Where("id = ?", "publication-a").Exec(t.Context())
			require.NoError(t, err)
			response := exportRequest(t, e, "format=csv&dataset=posts&account_id=account-x")
			require.Equal(t, http.StatusOK, response.Code)
			rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(response.Body.String(), string([]byte{0xEF, 0xBB, 0xBF})))).ReadAll()
			require.NoError(t, err)
			require.Len(t, rows, 2)
			require.Equal(t, "'"+title, rows[1][1], "formula-triggering Unicode and control prefixes remain literal text")
		})
	}
}

func TestAnalyticsExportWorkbookHasSheetsAndCharts(t *testing.T) {
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

func TestAnalyticsExportRejectsInvalidInput(t *testing.T) {
	e := newAnalyticsExportServer(t)
	for _, query := range []string{
		"timezone=Mars/Base",
		"timezone=Local",
		"days=45",
		"group_by=hour",
		"metrics=bad-key!",
	} {
		response := exportRequest(t, e, query)
		require.Contains(t, []int{http.StatusBadRequest, http.StatusUnprocessableEntity}, response.Code, query+": "+response.Body.String())
	}
}

func TestAnalyticsExportIncludesEveryPageOfContent(t *testing.T) {
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

func TestAnalyticsExportSelectsIndividualAccountsAcrossEveryTable(t *testing.T) {
	e, db := newAnalyticsExportServerWithDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "account-x2", WorkspaceID: "ws-1", Slug: "x-studio", Platform: "x", AccountID: "x-2", AccountUsername: "@studio", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "foreign", WorkspaceID: "ws-2", Slug: "foreign", Platform: "x", AccountID: "foreign", AccountUsername: "@foreign", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{ID: "rendition-x2", PublicationID: "publication-a", TargetKey: "studio", SocialAccountID: "account-x2", Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{ID: "foreign-publication", WorkspaceID: "ws-2", CreatedByID: "foreign-user", Title: "Private foreign post", Intent: "post", ContentProfile: models.ContentProfileShortText, Status: models.PublicationStatusPublished, ActualRunAt: now.Add(-time.Hour), CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{ID: "foreign-rendition", PublicationID: "foreign-publication", TargetKey: "post", SocialAccountID: "foreign", Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	for i, item := range []struct{ account, rendition, publication, platform, metrics string }{
		{"account-x", "rendition-a", "publication-a", "x", `{"likes":3,"views":10}`},
		{"account-x2", "rendition-x2", "publication-a", "x", `{"likes":5}`},
		{"account-yt", "rendition-b", "publication-b", "youtube", `{"views":20}`},
		{"foreign", "foreign-rendition", "foreign-publication", "x", `{"views":999}`},
	} {
		workspaceID := "ws-1"
		if item.account == "foreign" {
			workspaceID = "ws-2"
		}
		_, err = db.NewInsert().Model(&models.AnalyticsRenditionSnapshot{ID: fmt.Sprintf("snap-%d", i), WorkspaceID: workspaceID, SocialAccountID: item.account, PublicationID: item.publication, RenditionID: item.rendition, Platform: item.platform, MetricsJSON: item.metrics, CapturedAt: now.Add(-time.Hour)}).Exec(ctx)
		require.NoError(t, err)
		for day := 0; day < 2; day++ {
			_, err = db.NewInsert().Model(&models.AnalyticsAccountSnapshot{ID: fmt.Sprintf("account-snap-%d-%d", i, day), WorkspaceID: workspaceID, SocialAccountID: item.account, Platform: item.platform, MetricsJSON: fmt.Sprintf(`{"followers":%d}`, 100+(i+1)*day*10), CapturedAt: now.Add(-time.Duration(2-day) * 24 * time.Hour)}).Exec(ctx)
			require.NoError(t, err)
		}
	}
	read := func(query string) analyticsservice.ExportTable {
		t.Helper()
		response := exportRequest(t, e, "format=json&"+query)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var table analyticsservice.ExportTable
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &table))
		return table
	}
	for _, filter := range []string{"account_ids=account-x2", "account_id=account-x2"} {
		posts := read(filter + "&dataset=posts")
		require.Len(t, posts.Rows, 1)
		require.Equal(t, "@studio", posts.Rows[0][3])
		accounts := read(filter + "&dataset=accounts")
		require.Len(t, accounts.Rows, 1)
		require.Equal(t, "@studio", accounts.Rows[0][1])
		daily := read(filter + "&dataset=daily")
		var followers, engagement float64
		for _, row := range daily.Rows {
			if row[1] != nil {
				followers += row[1].(float64)
			}
			if row[2] != nil {
				engagement += row[2].(float64)
			}
			require.Nil(t, row[3], "this account has no measured views, even though other accounts do")
		}
		require.Equal(t, float64(20), followers)
		require.Equal(t, float64(5), engagement)
	}
	mixed := read("account_ids=account-x2,account-yt&dataset=accounts")
	require.Len(t, mixed.Rows, 2)
	mixed = read("account_ids=account-x2,account-yt&group_by=account")
	require.Len(t, mixed.Rows, 2)
	for _, dataset := range []string{"report", "posts", "daily", "accounts"} {
		foreign := read("account_ids=foreign&dataset=" + dataset)
		require.Empty(t, foreign.Rows, "foreign workspace account must never contribute to %s", dataset)
	}
	response := exportRequest(t, e, "format=xlsx&account_ids=account-x2")
	require.Equal(t, http.StatusOK, response.Code)
	file, err := excelize.OpenReader(bytes.NewReader(response.Body.Bytes()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = file.Close() })
	for _, sheet := range []string{"Posts", "Accounts"} {
		rows, err := file.GetRows(sheet)
		require.NoError(t, err)
		require.Len(t, rows, 2, "%s has one header and only the selected account's row", sheet)
	}
}
