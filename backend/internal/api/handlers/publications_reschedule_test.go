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
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

func TestUpdateScheduledPublicationReschedulesPublishJob(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	oldRunAt := now.Add(2 * time.Hour)
	newRunAt := now.Add(4 * time.Hour)

	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        "admin",
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Launch notes",
		ContentProfile:  "short_text",
		SourceText:      "Initial post text",
		SourceContent:   "Initial post text",
		Status:          models.PublicationStatusScheduled,
		ScheduledAt:     oldRunAt,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-1", "x")
	seedHandlerRendition(t, db, "rendition-1", "publication-1", "account-1", "x", "Initial post text", models.RenditionStatusScheduled)

	jobs := []models.Job{
		{
			ID:          "old-publication-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1"}`,
			Status:      "pending",
			RunAt:       oldRunAt,
			MaxAttempts: 3,
		},
		{
			ID:          "other-publication-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-2",
			Payload:     `{"publication_id":"publication-2"}`,
			Status:      "pending",
			RunAt:       oldRunAt,
			MaxAttempts: 3,
		},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)
	_, oldReceipts, err := publicationauth.CreateBatch(ctx, db, publicationauth.BatchInput{
		BatchID: "old-authorization-batch", PublicationID: "publication-1",
		Actor:  publicationauth.Actor{Origin: publicationauth.OriginLegacy, UserID: "user-1"},
		Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyScheduled,
		ConfirmedAt: now, Targets: []publicationauth.JobTarget{{JobID: "old-publication-job", RenditionID: "rendition-1", RunAt: oldRunAt}},
	})
	require.NoError(t, err)
	require.Len(t, oldReceipts, 1)
	oldReceipt := oldReceipts[0]

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)

	body := bytes.NewBufferString(`{"expected_revision":1,"scheduled_at":"` + newRunAt.Format(time.RFC3339) + `"}`)
	req := httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/publications/publication-1", body)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out PublicationResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, newRunAt.Format(time.RFC3339), out.ScheduledAt)

	var remaining []models.Job
	err = db.NewSelect().Model(&remaining).Order("id ASC").Scan(ctx)
	require.NoError(t, err)
	require.Len(t, remaining, 2)

	var rescheduled *models.Job
	for index := range remaining {
		job := &remaining[index]
		require.NotEqual(t, "old-publication-job", job.ID)
		payload := publicationJobPayload(t, job.Payload)
		if payload["publication_id"] == "publication-1" {
			require.NotEmpty(t, payload["authorization_batch_id"])
			require.Equal(t, newRunAt.Format(time.RFC3339), payload["authorization_scheduled_at"])
			rescheduled = job
		}
	}
	require.NotNil(t, rescheduled)
	require.Equal(t, jobTypePublishPublication, rescheduled.Type)
	require.True(t, rescheduled.RunAt.Equal(newRunAt), "expected run_at %s, got %s", newRunAt, rescheduled.RunAt)
	require.Contains(t, jobIDs(remaining), "other-publication-job")
	var storedOld models.PublicationAuthorization
	require.NoError(t, db.NewSelect().Model(&storedOld).Where("id = ?", oldReceipt.ID).Scan(ctx))
	require.Equal(t, oldReceipt, storedOld, "scheduled edits must append a receipt, never mutate the original")
	var receipts []models.PublicationAuthorization
	require.NoError(t, db.NewSelect().Model(&receipts).Where("publication_id = ?", "publication-1").Order("confirmed_at ASC", "id ASC").Scan(ctx))
	require.Len(t, receipts, 2)
	newReceipt := receipts[0]
	if newReceipt.ID == oldReceipt.ID {
		newReceipt = receipts[1]
	}
	require.NotEqual(t, oldReceipt.BatchID, newReceipt.BatchID)
	require.Equal(t, 2, newReceipt.PublicationRevision)
	require.True(t, newReceipt.ScheduledAt.Equal(newRunAt))
}

func TestCreatePublicationWithScheduledAtRemainsDraftWithoutJob(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	runAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)

	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        "admin",
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)

	body := bytes.NewBufferString(`{
		"workspace_id":"workspace-1",
		"title":"Launch notes",
		"content_profile":"short_text",
		"source_text":"Draft copy",
		"scheduled_at":"` + runAt.Format(time.RFC3339) + `"
	}`)
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/publications", body)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out PublicationResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, models.PublicationStatusDraft, out.Status)
	require.Equal(t, runAt.Format(time.RFC3339), out.ScheduledAt)

	var stored models.Publication
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", out.ID).Scan(ctx))
	require.Equal(t, models.PublicationStatusDraft, stored.Status)
	require.True(t, stored.ScheduledAt.Equal(runAt))

	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
}

func TestClearScheduledPublicationCancelsJobAndReturnsToDraft(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	runAt := now.Add(24 * time.Hour)

	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        "admin",
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Launch notes",
		ContentProfile:  "short_text",
		SourceText:      "Scheduled post text",
		SourceContent:   "Scheduled post text",
		SourceURL:       "https://example.com/launch",
		Goal:            "Inform customers",
		Audience:        "Existing customers",
		Status:          models.PublicationStatusScheduled,
		ScheduledAt:     runAt,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-1",
		PublicationID:   "publication-1",
		SocialAccountID: "account-1",
		Platform:        "x",
		Profile:         "short_text",
		Body:            "Scheduled post text",
		Title:           "Launch notes",
		SettingsJSON:    "{}",
		Status:          models.RenditionStatusScheduled,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)

	jobs := []models.Job{
		{
			ID:          "publication-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1"}`,
			Status:      "pending",
			RunAt:       runAt,
			MaxAttempts: 3,
		},
		{
			ID:          "other-publication-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-2",
			Payload:     `{"publication_id":"publication-2"}`,
			Status:      "pending",
			RunAt:       runAt,
			MaxAttempts: 3,
		},
		{
			ID:          "publication-reply-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1","rendition_id":"rendition-1","action":"reply"}`,
			Status:      jobStatusPending,
			RunAt:       runAt,
			MaxAttempts: 3,
		},
		{
			ID:          "completed-publication-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1"}`,
			Status:      "completed",
			RunAt:       runAt,
			MaxAttempts: 3,
		},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)

	req := httptest.NewRequestWithContext(
		ctx,
		http.MethodPut,
		"/api/v1/publications/publication-1",
		bytes.NewBufferString(`{"expected_revision":1,"clear_schedule":true}`),
	)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out PublicationResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, models.PublicationStatusDraft, out.Status)
	require.Empty(t, out.ScheduledAt)

	var stored models.Publication
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusDraft, stored.Status)
	require.True(t, stored.ScheduledAt.IsZero())
	require.Equal(t, "https://example.com/launch", stored.SourceURL)
	require.Equal(t, "Inform customers", stored.Goal)
	require.Equal(t, "Existing customers", stored.Audience)

	var remainingJobs []models.Job
	require.NoError(t, db.NewSelect().Model(&remainingJobs).Order("id ASC").Scan(ctx))
	require.Equal(t, []string{
		"completed-publication-job",
		"other-publication-job",
		"publication-reply-job",
	}, jobIDs(remainingJobs))

	var rendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusDraft, rendition.Status)
}

func TestProcessingPrimaryJobBlocksClearAndEditsAcrossRESTAndMCP(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	runAt := now.Add(time.Hour)
	lockedAt := now.Add(-time.Minute)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "In-flight publication",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Keep the delivery state",
		SourceContent:   "Keep the delivery state",
		Status:          models.PublicationStatusScheduled,
		ScheduledAt:     runAt,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:            "rendition-1",
		PublicationID: "publication-1",
		Platform:      "x",
		Profile:       models.ContentProfileShortText,
		Body:          "Keep the delivery state",
		Title:         "In-flight publication",
		SettingsJSON:  "{}",
		Status:        models.RenditionStatusScheduled,
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Exec(ctx)
	require.NoError(t, err)
	jobs := []models.Job{
		{
			ID:          "pending-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1"}`,
			Status:      jobStatusPending,
			RunAt:       runAt,
			MaxAttempts: 3,
		},
		{
			ID:          "processing-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1"}`,
			Status:      jobStatusProcessing,
			RunAt:       now,
			MaxAttempts: 3,
			LockedAt:    lockedAt,
			LockedBy:    "worker-1",
		},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	requireUnchanged := func() {
		t.Helper()
		var publication models.Publication
		require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
		require.Equal(t, models.PublicationStatusScheduled, publication.Status)
		require.True(t, publication.ScheduledAt.Equal(runAt))
		var rendition models.Rendition
		require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
		require.Equal(t, models.RenditionStatusScheduled, rendition.Status)
		var storedJobs []models.Job
		require.NoError(t, db.NewSelect().Model(&storedJobs).Order("id ASC").Scan(ctx))
		require.Equal(t, []string{"pending-job", "processing-job"}, jobIDs(storedJobs))
		require.Equal(t, jobStatusPending, storedJobs[0].Status)
		require.Equal(t, jobStatusProcessing, storedJobs[1].Status)
		require.True(t, storedJobs[1].LockedAt.Equal(lockedAt))
		require.Equal(t, "worker-1", storedJobs[1].LockedBy)
	}

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)
	requireHTTPConflict := func(path, body string) {
		t.Helper()
		req := httptest.NewRequestWithContext(ctx, http.MethodPut, path, bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()
		e.ServeHTTP(resp, req)
		require.Equal(t, http.StatusConflict, resp.Code, resp.Body.String())
		require.Contains(t, resp.Body.String(), errPublicationAlreadyProcessing.Error())
		requireUnchanged()
	}
	requireMCPConflict := func(result any, rpcErr *mcpError) {
		t.Helper()
		require.Nil(t, result)
		require.NotNil(t, rpcErr)
		require.Equal(t, -32602, rpcErr.Code)
		require.Equal(t, errPublicationAlreadyProcessing.Error(), rpcErr.Message)
		requireUnchanged()
	}

	requireHTTPConflict("/api/v1/publications/publication-1", `{"expected_revision":1,"title":"Changed"}`)
	requireHTTPConflict("/api/v1/publications/publication-1/renditions", `{"expected_revision":1,"renditions":[]}`)
	requireHTTPConflict("/api/v1/publications/publication-1", `{"expected_revision":1,"clear_schedule":true}`)

	mcpHandler := &MCPHandler{db: db}
	result, rpcErr := mcpHandler.updatePublication(ctx, "user-1", map[string]any{
		"publication_id":    "publication-1",
		"expected_revision": 1,
		"title":             "Changed",
	})
	requireMCPConflict(result, rpcErr)
	result, rpcErr = mcpHandler.setPublicationRenditions(ctx, "user-1", map[string]any{
		"publication_id":    "publication-1",
		"expected_revision": 1,
		"renditions":        []map[string]any{{"body": "Changed"}},
	})
	requireMCPConflict(result, rpcErr)
	result, rpcErr = mcpHandler.updatePublication(ctx, "user-1", map[string]any{
		"publication_id":    "publication-1",
		"expected_revision": 1,
		"clear_schedule":    true,
	})
	requireMCPConflict(result, rpcErr)
}

func TestSchedulePublicationRejectsNonFutureTime(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-past",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Past schedule",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Do not publish",
		SourceContent:   "Do not publish",
		Status:          models.PublicationStatusDraft,
		ScheduledAt:     now.Add(-time.Minute),
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/publications/publication-past/schedule", bytes.NewBufferString(`{"expected_revision":1}`))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "scheduled_at must be in the future")
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
}

func TestReschedulePublicationRejectsNonFutureTimeWithoutReplacingJob(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	future := now.Add(time.Hour)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Scheduled publication",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Keep queued",
		SourceContent:   "Keep queued",
		Status:          models.PublicationStatusScheduled,
		ScheduledAt:     future,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Job{
		ID:          "original-job",
		Type:        jobTypePublishPublication,
		ScopeID:     "publication-1",
		Payload:     `{"publication_id":"publication-1"}`,
		Status:      jobStatusPending,
		RunAt:       future,
		MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)
	body := bytes.NewBufferString(`{"expected_revision":1,"scheduled_at":"` + now.Add(-time.Minute).Format(time.RFC3339) + `"}`)
	req := httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/publications/publication-1", body)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.True(t, publication.ScheduledAt.Equal(future))
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Scan(ctx))
	require.Equal(t, []string{"original-job"}, jobIDs(jobs))
}

func TestClearScheduleCancelsOrphanPendingJobWhenPublicationStatusDrifted(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Drifted draft", ContentProfile: models.ContentProfileShortText,
		SourceText: "Draft", SourceContent: "Draft", Status: models.PublicationStatusDraft,
		ScheduledAt: now.Add(time.Hour), MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-1", "x")
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1", Platform: "x",
		Profile: models.ContentProfileShortText, Body: "Draft", Title: "Drifted draft", SettingsJSON: "{}",
		Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	jobs := []models.Job{
		{ID: "orphan-primary", Type: jobTypePublishPublication, ScopeID: "publication-1", Payload: `{"publication_id":"publication-1"}`, Status: jobStatusPending, RunAt: now.Add(time.Hour), MaxAttempts: 3},
		{ID: "reply", Type: jobTypePublishPublication, ScopeID: "publication-1", Payload: `{"publication_id":"publication-1","action":"reply"}`, Status: jobStatusPending, RunAt: now.Add(time.Hour), MaxAttempts: 3},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/publications/publication-1", bytes.NewBufferString(`{"expected_revision":1,"clear_schedule":true}`))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var remaining []models.Job
	require.NoError(t, db.NewSelect().Model(&remaining).Scan(ctx))
	require.Equal(t, []string{"reply"}, jobIDs(remaining))
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.True(t, publication.ScheduledAt.IsZero())
	var rendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusDraft, rendition.Status)
}

func TestSchedulePublicationRollsBackJobAndStatesTogether(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Atomic schedule", ContentProfile: models.ContentProfileShortText,
		SourceText: "Schedule atomically", SourceContent: "Schedule atomically", Status: models.PublicationStatusDraft,
		ScheduledAt: now.Add(time.Hour), MetadataJSON: "{}", ReleasePlanJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-atomic", "x")
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-atomic", Platform: "x",
		Profile: models.ContentProfileShortText, Body: "Schedule atomically", Title: "Atomic schedule", SettingsJSON: "{}",
		Status: models.RenditionStatusDraft, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.Exec(`
		CREATE TRIGGER fail_scheduled_rendition_update
		BEFORE UPDATE OF status ON renditions
		WHEN NEW.status = 'scheduled'
		BEGIN
			SELECT RAISE(ABORT, 'forced rendition update failure');
		END;
	`)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/publications/publication-1/schedule", bytes.NewBufferString(`{"expected_revision":1}`))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusInternalServerError, resp.Code, resp.Body.String())
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusDraft, publication.Status)
	var rendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusDraft, rendition.Status)
}

func TestMCPPublicationScheduleSemanticsMatchREST(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC().Truncate(time.Second)
	future := now.Add(time.Hour)
	input := mcpCreatePublicationInput{
		WorkspaceID:    "workspace-1",
		ContentProfile: models.ContentProfileShortText,
		SourceText:     "MCP draft",
		ScheduledAt:    &future,
	}
	require.Nil(t, validateMCPCreatePublicationInput(input, now))
	body := CreatePublicationBody{
		WorkspaceID: input.WorkspaceID, ContentProfile: input.ContentProfile,
		SourceText: input.SourceText, ScheduledAt: input.ScheduledAt,
	}
	normalizePublicationCreateBody(&body)
	publication := publicationModelFromCreate(body, "user-1", `{"mode":"inherit"}`, now)
	require.Equal(t, models.PublicationStatusDraft, publication.Status)
	require.True(t, publication.ScheduledAt.Equal(future))

	past := now.Add(-time.Minute)
	pastInput := input
	pastInput.ScheduledAt = &past
	rpcErr := validateMCPCreatePublicationInput(pastInput, now)
	require.NotNil(t, rpcErr)
	require.Equal(t, errPublicationScheduleFuture.Error(), rpcErr.Message)

	publication.Status = models.PublicationStatusScheduled
	publication.SourceURL = "https://example.com/source"
	update := PublicationUpdateBody{ClearSchedule: true}
	clear, reschedule, updateErr := applyPublicationScheduleUpdate(
		publication,
		update.ScheduledAt,
		update.ClearSchedule,
		now,
	)
	require.NoError(t, updateErr)
	applyPublicationFieldUpdates(publication, update)
	require.True(t, clear)
	require.False(t, reschedule)
	require.Equal(t, models.PublicationStatusDraft, publication.Status)
	require.True(t, publication.ScheduledAt.IsZero())
	require.Equal(t, "https://example.com/source", publication.SourceURL)
}

func TestMCPUpdatePublicationSchemaExposesCompatibleScheduleControls(t *testing.T) {
	t.Parallel()
	definition := mcpUpdatePublicationTool()
	inputSchema := definition.Descriptor["inputSchema"].(map[string]any)
	properties := inputSchema["properties"].(map[string]any)

	scheduledAt := properties["scheduled_at"].(map[string]any)
	require.Equal(t, "string", scheduledAt["type"])
	require.Equal(t, "date-time", scheduledAt["format"])
	clearSchedule := properties["clear_schedule"].(map[string]any)
	require.Equal(t, "boolean", clearSchedule["type"])
}

func TestPublishedPublicationMutationEndpointsPreserveDeliveryState(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	requests := []struct {
		publicationID string
		method        string
		path          string
		body          string
	}{
		{publicationID: "publication-update", method: http.MethodPut, path: "/api/v1/publications/publication-update", body: `{"expected_revision":1,"title":"Changed"}`},
		{publicationID: "publication-renditions", method: http.MethodPut, path: "/api/v1/publications/publication-renditions/renditions", body: `{"expected_revision":1,"renditions":[]}`},
		{publicationID: "publication-schedule", method: http.MethodPost, path: "/api/v1/publications/publication-schedule/schedule", body: `{"expected_revision":1}`},
		{publicationID: "publication-publish-now", method: http.MethodPost, path: "/api/v1/publications/publication-publish-now/publish-now", body: `{"expected_revision":1}`},
	}
	for _, request := range requests {
		_, err = db.NewInsert().Model(&models.Publication{
			ID:              request.publicationID,
			WorkspaceID:     "workspace-1",
			CreatedByID:     "user-1",
			Title:           "Delivered publication",
			ContentProfile:  models.ContentProfileShortText,
			SourceText:      "Already delivered",
			SourceContent:   "Already delivered",
			Status:          models.PublicationStatusPublished,
			ScheduledAt:     now.Add(time.Hour),
			MetadataJSON:    "{}",
			ReleasePlanJSON: "{}",
			CreatedAt:       now,
			UpdatedAt:       now,
		}).Exec(ctx)
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.Rendition{
			ID:              request.publicationID + "-rendition",
			PublicationID:   request.publicationID,
			SocialAccountID: "",
			Platform:        "x",
			Profile:         models.ContentProfileShortText,
			Body:            "Already delivered",
			Title:           "Delivered publication",
			SettingsJSON:    "{}",
			Status:          models.RenditionStatusPublished,
			ExternalID:      request.publicationID + "-external",
			ExternalURL:     "https://example.com/" + request.publicationID,
			CreatedAt:       now,
			UpdatedAt:       now,
		}).Exec(ctx)
		require.NoError(t, err)
	}

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)

	for _, request := range requests {
		req := httptest.NewRequestWithContext(ctx, request.method, request.path, bytes.NewBufferString(request.body))
		req.Header.Set("Authorization", "Bearer web-token")
		if request.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp := httptest.NewRecorder()
		e.ServeHTTP(resp, req)

		require.Equal(t, http.StatusBadRequest, resp.Code, "%s %s: %s", request.method, request.path, resp.Body.String())
		require.Contains(t, resp.Body.String(), errPublicationNotEditable.Error())

		var publication models.Publication
		require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", request.publicationID).Scan(ctx))
		require.Equal(t, models.PublicationStatusPublished, publication.Status)
		require.Equal(t, "Delivered publication", publication.Title)

		var rendition models.Rendition
		require.NoError(t, db.NewSelect().Model(&rendition).Where("publication_id = ?", request.publicationID).Scan(ctx))
		require.Equal(t, models.RenditionStatusPublished, rendition.Status)
		require.Equal(t, request.publicationID+"-external", rendition.ExternalID)
		require.Equal(t, "https://example.com/"+request.publicationID, rendition.ExternalURL)
	}

	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
}

func TestMCPPublishedPublicationActionsPreserveDeliveryState(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	actions := []struct {
		publicationID string
		run           func(*MCPHandler) (any, *mcpError)
	}{
		{
			publicationID: "publication-schedule",
			run: func(handler *MCPHandler) (any, *mcpError) {
				return handler.schedulePublication(ctx, "user-1", map[string]any{"publication_id": "publication-schedule", "expected_revision": 1})
			},
		},
		{
			publicationID: "publication-publish-now",
			run: func(handler *MCPHandler) (any, *mcpError) {
				return handler.publishPublicationNow(ctx, "user-1", map[string]any{"publication_id": "publication-publish-now", "expected_revision": 1})
			},
		},
	}
	for _, action := range actions {
		_, err = db.NewInsert().Model(&models.Publication{
			ID:              action.publicationID,
			WorkspaceID:     "workspace-1",
			CreatedByID:     "user-1",
			Title:           "Delivered publication",
			ContentProfile:  models.ContentProfileShortText,
			SourceText:      "Already delivered",
			SourceContent:   "Already delivered",
			Status:          models.PublicationStatusPublished,
			ScheduledAt:     now.Add(time.Hour),
			MetadataJSON:    "{}",
			ReleasePlanJSON: "{}",
			CreatedAt:       now,
			UpdatedAt:       now,
		}).Exec(ctx)
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.Rendition{
			ID:              action.publicationID + "-rendition",
			PublicationID:   action.publicationID,
			SocialAccountID: "",
			Platform:        "x",
			Profile:         models.ContentProfileShortText,
			Body:            "Already delivered",
			Title:           "Delivered publication",
			SettingsJSON:    "{}",
			Status:          models.RenditionStatusPublished,
			ExternalID:      action.publicationID + "-external",
			CreatedAt:       now,
			UpdatedAt:       now,
		}).Exec(ctx)
		require.NoError(t, err)
	}

	handler := &MCPHandler{db: db}
	for _, action := range actions {
		result, rpcErr := action.run(handler)
		require.Nil(t, result)
		require.NotNil(t, rpcErr)
		require.Equal(t, -32602, rpcErr.Code)
		require.Equal(t, errPublicationNotEditable.Error(), rpcErr.Message)

		var publication models.Publication
		require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", action.publicationID).Scan(ctx))
		require.Equal(t, models.PublicationStatusPublished, publication.Status)
		var rendition models.Rendition
		require.NoError(t, db.NewSelect().Model(&rendition).Where("publication_id = ?", action.publicationID).Scan(ctx))
		require.Equal(t, models.RenditionStatusPublished, rendition.Status)
		require.Equal(t, action.publicationID+"-external", rendition.ExternalID)
	}

	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
}

func TestPublicationActionsRejectProcessingPrimaryJobAcrossRESTAndMCP(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	runAt := now.Add(time.Hour)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Processing publication",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Do not queue twice",
		SourceContent:   "Do not queue twice",
		Status:          models.PublicationStatusScheduled,
		ScheduledAt:     runAt,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Job{
		ID:          "processing-job",
		Type:        jobTypePublishPublication,
		ScopeID:     "publication-1",
		Payload:     `{"publication_id":"publication-1"}`,
		Status:      jobStatusProcessing,
		RunAt:       now,
		MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	newReadyPublicationHandler(t, db, testAuthenticator{}).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/publications/publication-1/schedule", bytes.NewBufferString(`{"expected_revision":1}`))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusConflict, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), errPublicationAlreadyProcessing.Error())

	result, rpcErr := (&MCPHandler{db: db}).schedulePublication(ctx, "user-1", map[string]any{"publication_id": "publication-1", "expected_revision": 1})
	require.Nil(t, result)
	require.NotNil(t, rpcErr)
	require.Equal(t, -32602, rpcErr.Code)
	require.Equal(t, errPublicationAlreadyProcessing.Error(), rpcErr.Message)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Equal(t, "processing-job", jobs[0].ID)
	require.Equal(t, jobStatusProcessing, jobs[0].Status)
}

func TestPrimaryPublicationQueueUsesCurrentScheduleAtTransactionBoundary(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	staleRunAt := now.Add(time.Hour)
	currentRunAt := now.Add(2 * time.Hour)
	_, err := db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Rescheduled publication",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Use the current schedule",
		SourceContent:   "Use the current schedule",
		Status:          models.PublicationStatusScheduled,
		ScheduledAt:     staleRunAt,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-current", "x")
	seedHandlerRendition(t, db, "rendition-current", "publication-1", "account-current", "x", "Use the current schedule", models.RenditionStatusScheduled)
	_, err = db.NewInsert().Model(&models.Job{
		ID:          "stale-job",
		Type:        jobTypePublishPublication,
		ScopeID:     "publication-1",
		Payload:     `{"publication_id":"publication-1"}`,
		Status:      jobStatusPending,
		RunAt:       staleRunAt,
		MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewUpdate().Model((*models.Publication)(nil)).
		Set("scheduled_at = ?", currentRunAt).
		Where("id = ?", "publication-1").
		Exec(ctx)
	require.NoError(t, err)

	handler := newReadyPublicationHandler(t, db, testAuthenticator{})
	jobID, err := handler.queueScheduledPublication(ctx, "publication-1")
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx))
	require.True(t, job.RunAt.Equal(currentRunAt), "expected current run_at %s, got %s", currentRunAt, job.RunAt)
	require.False(t, job.RunAt.Equal(staleRunAt))

	_, err = db.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusDraft).
		Set("scheduled_at = ?", time.Time{}).
		Where("id = ?", "publication-1").
		Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewDelete().Model((*models.Job)(nil)).Where("id = ?", jobID).Exec(ctx)
	require.NoError(t, err)

	_, err = handler.queueScheduledPublication(ctx, "publication-1")
	require.ErrorIs(t, err, errPublicationScheduleRequired)
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
}

func TestPrimaryPublicationQueueRevalidatesLifecycleAtTransactionBoundary(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Lifecycle changed",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Do not mutate delivered work",
		SourceContent:   "Do not mutate delivered work",
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)

	var stalePublication models.Publication
	require.NoError(t, db.NewSelect().Model(&stalePublication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusDraft, stalePublication.Status)
	_, err = db.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusPublished).
		Where("id = ?", "publication-1").
		Exec(ctx)
	require.NoError(t, err)

	_, err = (&PublicationHandler{db: db}).queuePublicationNow(ctx, stalePublication.ID)
	require.ErrorIs(t, err, errPublicationNotEditable)
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
	var currentPublication models.Publication
	require.NoError(t, db.NewSelect().Model(&currentPublication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusPublished, currentPublication.Status)
}

func TestPrimaryPublicationQueueRejectsProcessingJobWithoutMutation(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	runAt := now.Add(time.Hour)
	_, err := db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Processing publication",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Do not queue twice",
		SourceContent:   "Do not queue twice",
		Status:          models.PublicationStatusScheduled,
		ScheduledAt:     runAt,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:            "rendition-1",
		PublicationID: "publication-1",
		Platform:      "x",
		Profile:       models.ContentProfileShortText,
		Body:          "Do not queue twice",
		Title:         "Processing publication",
		SettingsJSON:  "{}",
		Status:        models.RenditionStatusScheduled,
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Exec(ctx)
	require.NoError(t, err)
	jobs := []models.Job{
		{
			ID:          "pending-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1"}`,
			Status:      jobStatusPending,
			RunAt:       runAt,
			MaxAttempts: 3,
		},
		{
			ID:          "processing-job",
			Type:        jobTypePublishPublication,
			ScopeID:     "publication-1",
			Payload:     `{"publication_id":"publication-1"}`,
			Status:      jobStatusProcessing,
			RunAt:       now,
			MaxAttempts: 3,
		},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	_, err = (&PublicationHandler{db: db}).queuePublicationNow(ctx, "publication-1")
	require.ErrorIs(t, err, errPublicationAlreadyProcessing)

	var storedJobs []models.Job
	require.NoError(t, db.NewSelect().Model(&storedJobs).Order("id ASC").Scan(ctx))
	require.Equal(t, []string{"pending-job", "processing-job"}, jobIDs(storedJobs))
	require.Equal(t, jobStatusPending, storedJobs[0].Status)
	require.Equal(t, jobStatusProcessing, storedJobs[1].Status)
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusScheduled, publication.Status)
	require.True(t, publication.ScheduledAt.Equal(runAt))
	var rendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusScheduled, rendition.Status)
}

func TestPrimaryPublicationQueueReplacementKeepsOnePendingJob(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	firstRunAt := now.Add(time.Hour)
	secondRunAt := now.Add(2 * time.Hour)
	_, err := db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Queued publication",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Queue once",
		SourceContent:   "Queue once",
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-queue", "x")
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-1",
		PublicationID:   "publication-1",
		SocialAccountID: "account-queue",
		Platform:        "x",
		Profile:         models.ContentProfileShortText,
		Body:            "Queue once",
		Title:           "Queued publication",
		SettingsJSON:    "{}",
		Status:          models.RenditionStatusDraft,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)

	handler := newReadyPublicationHandler(t, db, testAuthenticator{})
	firstJobID, err := handler.queuePublication(ctx, "publication-1", firstRunAt)
	require.NoError(t, err)
	secondJobID, err := handler.queuePublication(ctx, "publication-1", secondRunAt)
	require.NoError(t, err)
	require.NotEqual(t, firstJobID, secondJobID)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Equal(t, secondJobID, jobs[0].ID)
	require.Equal(t, jobStatusPending, jobs[0].Status)
	payload := publicationJobPayload(t, jobs[0].Payload)
	require.Equal(t, "publication-1", payload["publication_id"])
	require.NotEmpty(t, payload["authorization_batch_id"])
	require.Equal(t, secondRunAt.Format(time.RFC3339), payload["authorization_scheduled_at"])
	require.True(t, jobs[0].RunAt.Equal(secondRunAt), "expected run_at %s, got %s", secondRunAt, jobs[0].RunAt)

	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, models.PublicationStatusScheduled, publication.Status)
	var rendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
	require.Equal(t, models.RenditionStatusScheduled, rendition.Status)
}

func TestPrimaryPublicationQueueUsesPostgresRowLockOnly(t *testing.T) {
	t.Parallel()
	require.True(t, primaryPublicationQueueUsesRowLock(dialect.PG))
	require.False(t, primaryPublicationQueueUsesRowLock(dialect.SQLite))

	db := createHandlerTestDB(t)
	require.Contains(t, primaryPublicationQueueLockQuery(db, "publication-1").String(), "FOR UPDATE")
}

func TestScheduledPublicationKeepsCompatibilityPostAndRandomDelay(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
		(*models.Post)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	scheduledAt := now.Add(2 * time.Hour)
	publication := &models.Publication{
		ID:              "publication-classic",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Classic post",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Keep the old scheduling behavior",
		SourceContent:   "Keep the old scheduling behavior",
		Status:          models.PublicationStatusDraft,
		ScheduledAt:     scheduledAt,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err := db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-classic", "x")
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-classic",
		PublicationID:   publication.ID,
		SocialAccountID: "account-classic",
		Platform:        "x",
		Profile:         models.ContentProfileShortText,
		Body:            publication.SourceText,
		SettingsJSON:    "{}",
		Status:          models.RenditionStatusDraft,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID:                 "post-classic",
		WorkspaceID:        publication.WorkspaceID,
		CreatedByID:        publication.CreatedByID,
		PublicationID:      publication.ID,
		Content:            publication.SourceText,
		Status:             models.PostStatusDraft,
		RandomDelayMinutes: 15,
		CreatedAt:          now,
	}).Exec(ctx)
	require.NoError(t, err)

	jobID, err := newReadyPublicationHandler(t, db, testAuthenticator{}).queueScheduledPublication(ctx, publication.ID)
	require.NoError(t, err)

	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(ctx))
	require.False(t, job.RunAt.Before(scheduledAt.Add(-15*time.Minute)))
	require.False(t, job.RunAt.After(scheduledAt.Add(15*time.Minute)))

	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-classic").Scan(ctx))
	require.Equal(t, models.PostStatusScheduled, post.Status)
	require.True(t, post.ScheduledAt.Equal(scheduledAt))
	require.True(t, post.ActualRunAt.Equal(job.RunAt))
}

func jobIDs(jobs []models.Job) []string {
	ids := make([]string, 0, len(jobs))
	for _, job := range jobs {
		ids = append(ids, job.ID)
	}
	return ids
}

func TestReplaceScheduledPublicationJobUsesRenditionOverrides(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	defaultRunAt := now.Add(2 * time.Hour)
	overrideRunAt := now.Add(3 * time.Hour)
	_, err := db.NewInsert().Model(&models.Publication{
		ID: "publication-overrides", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Staggered", Intent: models.PublishingIntentPost,
		CreationPreset: models.PublishingIntentPost, ContentProfile: models.ContentProfileShortText,
		SourceText: "Shared", SourceContent: "Shared", Status: models.PublicationStatusDraft,
		Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", RepostOverride: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-1", "x")
	seedHandlerAccount(t, db, "account-2", "bluesky")
	renditions := []models.Rendition{
		{ID: "rendition-default", PublicationID: "publication-overrides", SocialAccountID: "account-1", Platform: "x", Profile: models.ContentProfileShortText, OutputProfile: "x.post", SettingsJSON: "{}", Status: models.RenditionStatusDraft, CreatedAt: now},
		{ID: "rendition-override", PublicationID: "publication-overrides", SocialAccountID: "account-2", Platform: "bluesky", Profile: models.ContentProfileShortText, OutputProfile: "bluesky.post", ScheduleOverride: overrideRunAt, SettingsJSON: "{}", Status: models.RenditionStatusDraft, CreatedAt: now.Add(time.Second)},
	}
	_, err = db.NewInsert().Model(&renditions).Exec(ctx)
	require.NoError(t, err)

	err = db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		_, replaceErr := (&PublicationHandler{db: db}).replacePublicationJobTx(
			txCtx, tx, "publication-overrides", defaultRunAt,
		)
		return replaceErr
	})
	require.NoError(t, err)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Order("run_at ASC").Scan(ctx))
	require.Len(t, jobs, 2)
	firstPayload := publicationJobPayload(t, jobs[0].Payload)
	require.Equal(t, "publication-overrides", firstPayload["publication_id"])
	require.Equal(t, "rendition-default", firstPayload["rendition_id"])
	require.NotEmpty(t, firstPayload["authorization_batch_id"])
	require.True(t, jobs[0].RunAt.Equal(defaultRunAt))
	secondPayload := publicationJobPayload(t, jobs[1].Payload)
	require.Equal(t, "publication-overrides", secondPayload["publication_id"])
	require.Equal(t, "rendition-override", secondPayload["rendition_id"])
	require.Equal(t, firstPayload["authorization_batch_id"], secondPayload["authorization_batch_id"])
	require.True(t, jobs[1].RunAt.Equal(overrideRunAt))
}

func publicationJobPayload(t *testing.T, payload string) map[string]string {
	t.Helper()
	decoded := map[string]string{}
	require.NoError(t, json.Unmarshal([]byte(payload), &decoded))
	return decoded
}
