package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestApplyRandomDelayStaysWithinBounds(t *testing.T) {
	scheduledAt := time.Date(2026, time.May, 1, 12, 0, 0, 0, time.UTC)
	const maxDelay = 15

	for i := 0; i < 200; i++ {
		actual := postservice.ApplyRandomDelay(scheduledAt, maxDelay)
		diff := actual.Sub(scheduledAt)
		if diff < -15*time.Minute || diff > 15*time.Minute {
			t.Fatalf("random delay out of bounds: got %v", diff)
		}
	}
}

func TestApplyRandomDelayWithZeroDelayReturnsScheduledTime(t *testing.T) {
	scheduledAt := time.Date(2026, time.May, 1, 12, 0, 0, 0, time.UTC)

	actual := postservice.ApplyRandomDelay(scheduledAt, 0)
	if !actual.Equal(scheduledAt) {
		t.Fatalf("expected unchanged time, got %s want %s", actual, scheduledAt)
	}
}

func TestListPostsOrderExpressionKeepsCoalesceCall(t *testing.T) {
	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = sqldb.Close()
	})

	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() {
		_ = db.Close()
	})

	query := db.NewSelect().
		Model((*models.Post)(nil))
	query = applyListPostsOrder(query).Limit(50)

	require.Contains(t, query.String(), "ORDER BY COALESCE(scheduled_at, created_at) DESC")

	_, err = db.NewCreateTable().Model((*models.Post)(nil)).IfNotExists().Exec(context.Background())
	require.NoError(t, err)

	var posts []models.Post
	query = db.NewSelect().Model(&posts)
	err = applyListPostsOrder(query).Limit(50).Scan(context.Background())
	require.NoError(t, err)
}

func TestPostResponseForListPreservesThreadHierarchy(t *testing.T) {
	t.Parallel()

	response := postResponseForList(models.Post{
		ID:             "reply-2",
		ParentPostID:   "reply-1",
		ThreadSequence: 2,
	}, nil, nil)

	require.Equal(t, "reply-1", response.ParentPostID)
	require.Equal(t, 2, response.ThreadSequence)
}

func TestBuildScheduleOverviewDaysUsesWorkspaceDSTAndCountsCanonicalPublications(t *testing.T) {
	t.Parallel()

	location, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)

	publications := []scheduleOverviewPublication{
		{
			ID:          "before-dst-jump",
			WorkspaceID: "workspace-1",
			OccursAt:    time.Date(2026, time.March, 8, 4, 30, 0, 0, time.UTC),
		},
		{
			ID:          "after-dst-jump",
			WorkspaceID: "workspace-1",
			OccursAt:    time.Date(2026, time.March, 8, 7, 30, 0, 0, time.UTC),
		},
		{
			ID:          "unscheduled",
			WorkspaceID: "workspace-1",
		},
	}
	platformsByPublication := map[string][]string{
		"before-dst-jump": {"x", "bluesky", "x", ""},
		"after-dst-jump":  {"x"},
	}

	days := buildScheduleOverviewDays(publications, platformsByPublication, location, "")

	require.Equal(t, []ScheduleDay{
		{
			Date:  "2026-03-07",
			Count: 1,
			Platforms: []ScheduleDayPlatform{
				{Platform: "bluesky", Count: 1},
				{Platform: "x", Count: 1},
			},
			Workspaces: []ScheduleDayWorkspace{{WorkspaceID: "workspace-1", Count: 1}},
		},
		{
			Date:       "2026-03-08",
			Count:      1,
			Platforms:  []ScheduleDayPlatform{{Platform: "x", Count: 1}},
			Workspaces: []ScheduleDayWorkspace{{WorkspaceID: "workspace-1", Count: 1}},
		},
	}, days)

	xDays := buildScheduleOverviewDays(publications, platformsByPublication, location, "x")
	require.Len(t, xDays, 2)
	require.Equal(t, []ScheduleDayPlatform{{Platform: "x", Count: 1}}, xDays[0].Platforms)
	require.Equal(t, []ScheduleDayPlatform{{Platform: "x", Count: 1}}, xDays[1].Platforms)
	require.Empty(t, buildScheduleOverviewDays(publications, platformsByPublication, location, "linkedin"))
}

func TestResolveScheduleOverviewPeriodUsesWorkspaceMonthAndDSTBounds(t *testing.T) {
	t.Parallel()

	tokyo, err := time.LoadLocation("Asia/Tokyo")
	require.NoError(t, err)
	tokyoPeriod, err := resolveScheduleOverviewPeriod(
		"",
		tokyo,
		time.Date(2026, time.March, 31, 15, 30, 0, 0, time.UTC),
	)
	require.NoError(t, err)
	require.Equal(t, 2026, tokyoPeriod.year)
	require.Equal(t, time.April, tokyoPeriod.month)
	require.Equal(t, time.Date(2026, time.March, 31, 15, 0, 0, 0, time.UTC), tokyoPeriod.start)
	require.Equal(t, time.Date(2026, time.April, 30, 15, 0, 0, 0, time.UTC), tokyoPeriod.end)

	losAngeles, err := time.LoadLocation("America/Los_Angeles")
	require.NoError(t, err)
	losAngelesPeriod, err := resolveScheduleOverviewPeriod(
		"",
		losAngeles,
		time.Date(2026, time.April, 1, 6, 30, 0, 0, time.UTC),
	)
	require.NoError(t, err)
	require.Equal(t, 2026, losAngelesPeriod.year)
	require.Equal(t, time.March, losAngelesPeriod.month)
	require.Equal(t, time.Date(2026, time.March, 1, 8, 0, 0, 0, time.UTC), losAngelesPeriod.start)
	require.Equal(t, time.Date(2026, time.April, 1, 7, 0, 0, 0, time.UTC), losAngelesPeriod.end)

	_, err = resolveScheduleOverviewPeriod("2026-13", time.UTC, time.Now())
	require.Error(t, err)
}

func TestPostReadEndpointsHonorTokenWorkspaceScope(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.SocialAccount)(nil),
		(*models.PostMedia)(nil),
	)
	ctx := context.Background()
	createdAt := time.Date(2026, time.July, 1, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&[]models.Workspace{
		{ID: "ws-1", Name: "Scoped", Timezone: "UTC", CreatedAt: createdAt},
		{ID: "ws-2", Name: "Outside", Timezone: "UTC", CreatedAt: createdAt.Add(time.Hour)},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "ws-2", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Post{
		{ID: "scoped-post", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "visible", Status: statusScheduled, ScheduledAt: time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC), CreatedAt: createdAt},
		{ID: "outside-post", WorkspaceID: "ws-2", CreatedByID: "user-1", Content: "hidden", Status: statusScheduled, ScheduledAt: time.Date(2026, time.July, 11, 12, 0, 0, 0, time.UTC), CreatedAt: createdAt},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Publication{
		{
			ID: "scoped-publication", WorkspaceID: "ws-1", CreatedByID: "user-1",
			Title: "visible", SourceContent: "visible", Status: models.PublicationStatusScheduled,
			ScheduledAt: time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC), CreatedAt: createdAt, UpdatedAt: createdAt,
		},
		{
			ID: "outside-publication", WorkspaceID: "ws-2", CreatedByID: "user-1",
			Title: "hidden", SourceContent: "hidden", Status: models.PublicationStatusScheduled,
			ScheduledAt: time.Date(2026, time.July, 11, 12, 0, 0, 0, time.UTC), CreatedAt: createdAt, UpdatedAt: createdAt,
		},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Rendition{
		{
			ID: "scoped-rendition", PublicationID: "scoped-publication", SocialAccountID: "account-1",
			Platform: "x", Status: models.RenditionStatusScheduled, SettingsJSON: "{}", CreatedAt: createdAt, UpdatedAt: createdAt,
		},
		{
			ID: "outside-rendition", PublicationID: "outside-publication", SocialAccountID: "account-2",
			Platform: "x", Status: models.RenditionStatusScheduled, SettingsJSON: "{}", CreatedAt: createdAt, UpdatedAt: createdAt,
		},
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewPostHandler(db, workspaceScopedTestAuthenticator{workspaceID: "ws-1"})
	handler.ListPosts(api)
	handler.GetScheduleOverview(api)

	get := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer web-token")
		resp := httptest.NewRecorder()
		e.ServeHTTP(resp, req)
		return resp
	}

	postsResp := get("/api/v1/posts")
	require.Equal(t, http.StatusOK, postsResp.Code, postsResp.Body.String())
	var posts []PostResponse
	require.NoError(t, json.Unmarshal(postsResp.Body.Bytes(), &posts))
	require.Len(t, posts, 1)
	require.Equal(t, "scoped-post", posts[0].ID)
	require.Equal(t, http.StatusForbidden, get("/api/v1/posts?workspace_id=ws-2").Code)

	overviewResp := get("/api/v1/posts/schedule-overview?month=2026-07")
	require.Equal(t, http.StatusOK, overviewResp.Code, overviewResp.Body.String())
	var overview ScheduleOverviewOutput
	require.NoError(t, json.Unmarshal(overviewResp.Body.Bytes(), &overview.Body))
	require.Equal(t, "ws-1", overview.Body.SelectedWorkspaceID)
	require.Equal(t, []WorkspaceResp{{
		WorkspaceID:        "ws-1",
		WorkspaceName:      "Scoped",
		WorkspaceCreatedAt: createdAt.Format(time.RFC3339),
	}}, overview.Body.Workspaces)
	require.Len(t, overview.Body.Days, 1)
	require.Equal(t, 1, overview.Body.Days[0].Count, "the legacy post and canonical publication must not be double counted")
	require.Equal(t, http.StatusForbidden, get("/api/v1/posts/schedule-overview?workspace_id=ws-2&month=2026-07").Code)

	_, err = db.NewUpdate().Model((*models.Workspace)(nil)).
		Set("timezone = ?", "Asia/Tokyo").
		Where("id = ?", "ws-1").
		Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Post{
		{ID: "tokyo-local-day", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "local", Status: statusScheduled, ScheduledAt: time.Date(2026, time.July, 8, 15, 30, 0, 0, time.UTC), CreatedAt: createdAt},
		{ID: "utc-day-decoy", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "decoy", Status: statusScheduled, ScheduledAt: time.Date(2026, time.July, 9, 15, 30, 0, 0, time.UTC), CreatedAt: createdAt},
	}).Exec(ctx)
	require.NoError(t, err)

	dateResp := get("/api/v1/posts?date=2026-07-09&limit=200")
	require.Equal(t, http.StatusOK, dateResp.Code, dateResp.Body.String())
	var datePosts []PostResponse
	require.NoError(t, json.Unmarshal(dateResp.Body.Bytes(), &datePosts))
	require.Len(t, datePosts, 1)
	require.Equal(t, "tokyo-local-day", datePosts[0].ID)
}

type workspaceScopedTestAuthenticator struct {
	workspaceID string
}

func (authenticator workspaceScopedTestAuthenticator) AuthenticateBearer(ctx context.Context, token string) (*middleware.Principal, error) {
	principal, err := (testAuthenticator{}).AuthenticateBearer(ctx, token)
	if err != nil {
		return nil, err
	}
	principal.WorkspaceID = authenticator.workspaceID
	return principal, nil
}

func TestListPostsPaginatesVisiblePostsWithHeaders(t *testing.T) {
	t.Parallel()

	srv := newListPostsTestServer(t)
	srv.seedPosts(t)

	resp := srv.getJSON(t, "/api/v1/posts?limit=2&offset=1")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, "4", resp.Header().Get("X-Total-Count"))
	require.Equal(t, "2", resp.Header().Get("X-Limit"))
	require.Equal(t, "1", resp.Header().Get("X-Offset"))
	require.Equal(t, "3", resp.Header().Get("X-Next-Offset"))
	require.Equal(t, "true", resp.Header().Get("X-Has-More"))

	var out []PostResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out, 2)
	require.Equal(t, "post-3", out[0].ID)
	require.Equal(t, "post-2", out[1].ID)
}

func TestListPostsCountsFilteredWorkspaceScope(t *testing.T) {
	t.Parallel()

	srv := newListPostsTestServer(t)
	srv.seedPosts(t)

	resp := srv.getJSON(t, "/api/v1/posts?workspace_id=ws-1&status=draft&limit=1")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, "2", resp.Header().Get("X-Total-Count"))
	require.Equal(t, "1", resp.Header().Get("X-Limit"))
	require.Equal(t, "0", resp.Header().Get("X-Offset"))
	require.Equal(t, "1", resp.Header().Get("X-Next-Offset"))
	require.Equal(t, "true", resp.Header().Get("X-Has-More"))

	var out []PostResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out, 1)
	require.Equal(t, statusDraft, out[0].Status)
}

func TestListPostsRejectsNegativeOffset(t *testing.T) {
	t.Parallel()

	srv := newListPostsTestServer(t)

	resp := srv.getJSON(t, "/api/v1/posts?offset=-1")

	require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "offset must be greater than or equal to 0")
}

func TestListPostsDateUsesWorkspaceLocalDayBounds(t *testing.T) {
	t.Parallel()

	srv := newListPostsTestServer(t)
	posts := []models.Post{
		{ID: "previous-local-day", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "previous", Status: statusScheduled, ScheduledAt: time.Date(2026, 7, 19, 22, 59, 0, 0, time.UTC)},
		{ID: "local-day-start", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "start", Status: statusScheduled, ScheduledAt: time.Date(2026, 7, 19, 23, 0, 0, 0, time.UTC)},
		{ID: "local-day-end", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "end", Status: statusScheduled, ScheduledAt: time.Date(2026, 7, 20, 22, 59, 0, 0, time.UTC)},
		{ID: "next-local-day", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "next", Status: statusScheduled, ScheduledAt: time.Date(2026, 7, 20, 23, 0, 0, 0, time.UTC)},
	}
	_, err := srv.db.NewInsert().Model(&posts).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.getJSON(t, "/api/v1/posts?workspace_id=ws-1&date=2026-07-20&limit=200")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.Equal(t, "2", resp.Header().Get("X-Total-Count"))
	var out []PostResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out, 2)
	require.Equal(t, []string{"local-day-end", "local-day-start"}, []string{out[0].ID, out[1].ID})
}

func TestUpsertVariantsRejectsNullMediaIDsWithoutPersistence(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(
		t,
		(*models.WorkspaceMember)(nil),
		(*models.Post)(nil),
		(*models.PostVariant)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID:          "post-1",
		WorkspaceID: "ws-1",
		CreatedByID: "user-1",
		Content:     "source content",
		Status:      statusDraft,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostHandler(db, testAuthenticator{}).UpsertVariants(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/v1/posts/post-1/variants", strings.NewReader(`{"variants":[{"social_account_id":"account-1","media_ids":"null","is_unsynced":false}]}`))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	count, err := db.NewSelect().Model((*models.PostVariant)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}

type listPostsTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newListPostsTestServer(t *testing.T) *listPostsTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.SocialAccount)(nil),
		(*models.PostMedia)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{
		ID:       "ws-1",
		Name:     "Workspace",
		Timezone: "Europe/Lisbon",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostHandler(db, testAuthenticator{}).ListPosts(api)
	return &listPostsTestServer{echo: e, db: db}
}

func (s *listPostsTestServer) seedPosts(t *testing.T) {
	t.Helper()

	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	posts := []models.Post{
		{ID: "post-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "one", Status: statusDraft, ScheduledAt: now.Add(time.Minute), CreatedAt: now.Add(time.Minute)},
		{ID: "post-2", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "two", Status: statusScheduled, ScheduledAt: now.Add(2 * time.Minute), CreatedAt: now.Add(2 * time.Minute)},
		{ID: "post-3", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "three", Status: statusDraft, ScheduledAt: now.Add(3 * time.Minute), CreatedAt: now.Add(3 * time.Minute)},
		{ID: "post-4", WorkspaceID: "ws-1", CreatedByID: "user-1", Content: "four", Status: statusScheduled, ScheduledAt: now.Add(4 * time.Minute), CreatedAt: now.Add(4 * time.Minute)},
		{ID: "post-foreign", WorkspaceID: "ws-2", CreatedByID: "other-user", Content: "foreign", Status: statusDraft, ScheduledAt: now.Add(5 * time.Minute), CreatedAt: now.Add(5 * time.Minute)},
	}
	_, err := s.db.NewInsert().Model(&posts).Exec(context.Background())
	require.NoError(t, err)
}

func (s *listPostsTestServer) getJSON(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}
