package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

func TestBatchSchedulePreviewIsReadOnlyAndConfirmationReplays(t *testing.T) {
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	ctx := context.Background()
	h := srv.handler.publicationHandler()
	h.auth = testAuthenticator{}
	server := echo.New()
	api := humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	h.RegisterRoutes(api)
	post, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "A factual update", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	start := time.Now().UTC().AddDate(0, 0, 2).Format("2006-01-02")
	payload := map[string]any{"workspace_id": "ws-1", "publication_ids": []string{post.ID}, "start_date": start, "end_date": start, "hour": 10, "minute": 0, "interval_days": 1, "use_slots": false}
	response := publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/batch-schedule/preview", payload)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var preview struct {
		Items []struct {
			PublicationID    string `json:"publication_id"`
			ExpectedRevision int    `json:"expected_revision"`
			ScheduledAt      string `json:"scheduled_at"`
			Error            string `json:"error"`
			Preserved        bool   `json:"preserved"`
		} `json:"items"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &preview))
	require.Len(t, preview.Items, 1)
	require.Empty(t, preview.Items[0].Error)
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", post.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	confirm := map[string]any{"workspace_id": "ws-1", "batch_id": "test-batch", "items": preview.Items}
	response = publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/batch-schedule/confirm", confirm)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), `"state":"scheduled"`)
	_, err = srv.db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusPublished).Where("id = ?", post.ID).Exec(ctx)
	require.NoError(t, err)
	response = publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/batch-schedule/confirm", confirm)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), `"state":"scheduled"`, "an accepted receipt remains replayable after delivery")
	count, err = srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", post.ID).Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

func TestBatchScheduleUsesLocalDaysAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Lisbon")
	require.NoError(t, err)
	start := time.Date(2027, 3, 27, 0, 0, 0, 0, loc)
	end := start.AddDate(0, 0, 2)
	dates := batchScheduleDates(start, end, 10, 0, 1, false, nil, start.AddDate(0, 0, -1))
	require.Len(t, dates, 3)
	require.Equal(t, "2027-03-27T10:00:00Z", dates[0].UTC().Format(time.RFC3339))
	require.Equal(t, "2027-03-28T09:00:00Z", dates[1].UTC().Format(time.RFC3339))
	require.Equal(t, "2027-03-29T09:00:00Z", dates[2].UTC().Format(time.RFC3339))
	gap := batchScheduleDates(start, end, 1, 30, 1, false, nil, start.AddDate(0, 0, -1))
	require.Len(t, gap, 2, "nonexistent spring-forward clock time is not silently moved")
}

func TestBatchPreviewReservesMonthlyCapacityAcrossSelection(t *testing.T) {
	srv := newMCPTestServerWithEntitlement(t, entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitScheduledPostsMonthly: 1}}))
	h := srv.handler.publicationHandler()
	h.auth = testAuthenticator{}
	server := echo.New()
	api := humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	h.RegisterRoutes(api)
	ctx := t.Context()
	ids := make([]string, 0, 2)
	for _, text := range []string{"First release", "Second release"} {
		post, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: text, SocialAccountIDs: []string{"account-1"}})
		require.NoError(t, err)
		ids = append(ids, post.ID)
	}
	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month()+1, 2, 0, 0, 0, 0, time.UTC)
	response := publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/batch-schedule/preview", map[string]any{"workspace_id": "ws-1", "publication_ids": ids, "start_date": start.Format(time.DateOnly), "end_date": start.AddDate(0, 0, 3).Format(time.DateOnly), "hour": 10, "minute": 0, "interval_days": 1, "use_slots": false})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var preview struct {
		Items []BatchScheduleItem `json:"items"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &preview))
	require.Len(t, preview.Items, 2)
	require.Empty(t, preview.Items[0].Error)
	require.Contains(t, preview.Items[1].Error, "limit exceeded")
	value, err := h.usage.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, start)
	require.NoError(t, err)
	require.Zero(t, value)
}

func TestScheduledAdmissionReservesQuotaBeforeCommittingJob(t *testing.T) {
	srv := newMCPTestServerWithEntitlement(t, entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitScheduledPostsMonthly: 1}}))
	h := srv.handler.publicationHandler()
	ctx := t.Context()
	at := time.Now().UTC().Add(time.Hour)
	first, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "First", SocialAccountIDs: []string{"account-1"}, ScheduledAt: &at})
	require.NoError(t, err)
	second, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Second", SocialAccountIDs: []string{"account-1"}, ScheduledAt: &at})
	require.NoError(t, err)
	// Another admission wins the final allowance after this request's preflight.
	h.beforeQueueTransaction = func(ctx context.Context) error {
		h.beforeQueueTransaction = nil
		_, err := h.publicationApplication().Schedule(ctx, "user-1", second.ID, second.Revision, providerreadiness.ExecutionIntentProduction)
		return err
	}
	_, err = h.publicationApplication().Schedule(ctx, "user-1", first.ID, first.Revision, providerreadiness.ExecutionIntentProduction)
	require.ErrorContains(t, err, "limit exceeded")
	jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", first.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobs)
	post, err := h.publicationApplication().Get(ctx, "user-1", first.ID)
	require.NoError(t, err)
	require.Equal(t, "draft", post.Status)
	value, err := h.usage.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, at)
	require.NoError(t, err)
	require.EqualValues(t, 1, value)
}

func TestBatchScheduleKeepsSeriesApartAndCommitsOnlyCurrentItems(t *testing.T) {
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	h := srv.handler.publicationHandler()
	h.auth = testAuthenticator{}
	server := echo.New()
	api := humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	h.RegisterRoutes(api)
	ctx := t.Context()
	now := time.Now().UTC()
	at := time.Date(now.Year(), now.Month()+1, 2, 10, 0, 0, 0, time.UTC)
	metadata := map[string]interface{}{"series": map[string]interface{}{"build_id": "shared-source"}}
	first, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Already planned", SocialAccountIDs: []string{"account-1"}, ScheduledAt: &at, Metadata: metadata})
	require.NoError(t, err)
	second, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "The lesson", SocialAccountIDs: []string{"account-1"}, Metadata: metadata})
	require.NoError(t, err)
	third, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Another angle", SocialAccountIDs: []string{"account-1"}, Metadata: metadata})
	require.NoError(t, err)
	response := publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/batch-schedule/preview", map[string]any{"workspace_id": "ws-1", "publication_ids": []string{second.ID, third.ID}, "start_date": at.Format(time.DateOnly), "end_date": at.AddDate(0, 0, 2).Format(time.DateOnly), "hour": 14, "minute": 0, "interval_days": 1, "use_slots": false})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var preview struct {
		Items []BatchScheduleItem `json:"items"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &preview))
	require.Len(t, preview.Items, 2)
	require.Equal(t, at.AddDate(0, 0, 1).Add(4*time.Hour).Format(time.RFC3339), preview.Items[0].ScheduledAt)
	require.Equal(t, at.AddDate(0, 0, 2).Add(4*time.Hour).Format(time.RFC3339), preview.Items[1].ScheduledAt)
	changed := "Edited elsewhere"
	require.NoError(t, h.publicationApplication().Update(ctx, "user-1", third.ID, PublicationUpdateBody{ExpectedRevision: third.Revision, SourceText: &changed}))
	confirm := map[string]any{"workspace_id": "ws-1", "batch_id": "partial-series", "items": preview.Items}
	for range 2 {
		response = publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/batch-schedule/confirm", confirm)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var outcomes []BatchScheduleOutcome
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &outcomes))
		require.Len(t, outcomes, 2)
		require.Equal(t, "scheduled", outcomes[0].State)
		require.Equal(t, "failed", outcomes[1].State)
	}
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", second.ID).Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	unchanged, err := h.publicationApplication().Get(ctx, "user-1", first.ID)
	require.NoError(t, err)
	require.Equal(t, at.Format(time.RFC3339), unchanged.ScheduledAt)
	require.Equal(t, "draft", unchanged.Status)
}

func TestBatchPreviewRejectedDraftDoesNotConsumeAvailableDate(t *testing.T) {
	srv := newMCPTestServer(t)
	h := srv.handler.publicationHandler()
	h.auth = testAuthenticator{}
	server := echo.New()
	api := humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	h.RegisterRoutes(api)
	ctx := t.Context()
	invalid, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Destination-specific timing", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	valid, err := h.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{WorkspaceID: "ws-1", SourceText: "Ready", SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.Rendition)(nil)).Set("schedule_override = ?", time.Now().UTC().Add(24*time.Hour)).Where("publication_id = ?", invalid.ID).Exec(ctx)
	require.NoError(t, err)
	day := time.Now().UTC().AddDate(0, 0, 2).Format(time.DateOnly)
	response := publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/batch-schedule/preview", map[string]any{"workspace_id": "ws-1", "publication_ids": []string{invalid.ID, valid.ID}, "start_date": day, "end_date": day, "hour": 10, "minute": 0, "interval_days": 1, "use_slots": false})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var preview struct {
		Items []BatchScheduleItem `json:"items"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &preview))
	require.Len(t, preview.Items, 2)
	require.NotEmpty(t, preview.Items[0].Error)
	require.Empty(t, preview.Items[1].Error)
	require.Equal(t, day+"T10:00:00Z", preview.Items[1].ScheduledAt)
}
