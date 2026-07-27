package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestPublicationPathIDDecodesLegacyPublicationIDs(t *testing.T) {
	require.Equal(t, "legacy-publication:post-1", publicationPathID("legacy-publication%3Apost-1"))
	require.Equal(t, "publication-1", publicationPathID("publication-1"))
}

func TestRetryFailedPublicationRenditionsQueuesOnlyRetryableFailures(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
		(*models.PublicationLifecycleEvent)(nil),
	)
	ctx := context.Background()
	now := time.Date(2026, time.July, 27, 9, 0, 0, 0, time.UTC)
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
		Title:           "Launch",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Launch",
		SourceContent:   "Launch",
		Status:          models.PublicationStatusFailed,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Rendition{
		{
			ID: "published-rendition", PublicationID: "publication-1", SocialAccountID: "account-1",
			Platform: "x", Profile: models.ContentProfileShortText, Body: "Launch", SettingsJSON: "{}",
			Status: models.RenditionStatusPublished,
		},
		{
			ID: "retryable-rendition", PublicationID: "publication-1", SocialAccountID: "account-2",
			Platform: "mastodon", Profile: models.ContentProfileShortText, Body: "Launch", SettingsJSON: "{}",
			Status: models.RenditionStatusFailed, ErrorKind: "network", ErrorRetryable: true,
		},
		{
			ID: "permanent-rendition", PublicationID: "publication-1", SocialAccountID: "account-3",
			Platform: "linkedin", Profile: models.ContentProfileShortText, Body: "Launch", SettingsJSON: "{}",
			Status: models.RenditionStatusFailed, ErrorKind: "validation", ErrorRetryable: false,
		},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("error_retryable = ?", true).
		Where("id = ?", "retryable-rendition").
		Exec(ctx)
	require.NoError(t, err)
	var insertedRetryable models.Rendition
	require.NoError(t, db.NewSelect().Model(&insertedRetryable).Where("id = ?", "retryable-rendition").Scan(ctx))
	require.True(t, insertedRetryable.ErrorRetryable)
	require.Equal(t, models.RenditionStatusFailed, insertedRetryable.Status)
	_, err = db.NewInsert().Model(&models.Job{
		ID:          "old-pending-job",
		Type:        jobTypePublishPublication,
		Payload:     `{"publication_id":"publication-1"}`,
		Status:      jobStatusPending,
		RunAt:       now.Add(time.Hour),
		MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	req := httptest.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"/api/v1/publications/publication-1/retry-failed",
		nil,
	)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var renditions []models.Rendition
	require.NoError(t, db.NewSelect().Model(&renditions).Order("id ASC").Scan(ctx))
	statusByID := make(map[string]string, len(renditions))
	for _, rendition := range renditions {
		statusByID[rendition.ID] = rendition.Status
	}
	require.Equal(t, models.RenditionStatusFailed, statusByID["permanent-rendition"])
	require.Equal(t, models.RenditionStatusPublished, statusByID["published-rendition"])
	require.Equal(t, models.RenditionStatusScheduled, statusByID["retryable-rendition"])

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("status = ?", jobStatusPending).Scan(ctx))
	require.Len(t, jobs, 1)
	require.NotEqual(t, "old-pending-job", jobs[0].ID)
	require.Contains(t, jobs[0].Payload, `"publication_id":"publication-1"`)

	var events []models.PublicationLifecycleEvent
	require.NoError(t, db.NewSelect().Model(&events).Scan(ctx))
	require.Len(t, events, 1)
	require.Equal(t, "Retry queued for failed destinations", events[0].Message)

	retryAgain := httptest.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"/api/v1/publications/publication-1/retry-failed",
		nil,
	)
	retryAgain.Header.Set("Authorization", "Bearer web-token")
	retryAgainRec := httptest.NewRecorder()
	e.ServeHTTP(retryAgainRec, retryAgain)
	require.Equal(t, http.StatusConflict, retryAgainRec.Code, retryAgainRec.Body.String())
	var jobsAfterConflict []models.Job
	require.NoError(t, db.NewSelect().Model(&jobsAfterConflict).Where("status = ?", jobStatusPending).Scan(ctx))
	require.Len(t, jobsAfterConflict, 1)
	require.Equal(t, jobs[0].ID, jobsAfterConflict[0].ID)
}

func TestUpsertPublicationRenditionsPreservesOmittedRenditionsUntilExplicitDelete(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Date(2026, time.July, 1, 9, 0, 0, 0, time.UTC)

	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.SocialAccount{
		{
			ID:              "youtube-account",
			WorkspaceID:     "workspace-1",
			Slug:            "youtube",
			Platform:        "youtube",
			AccountID:       "channel-1",
			AccountUsername: "channel",
			AccessTokenEnc:  []byte("token"),
			IsActive:        true,
		},
		{
			ID:              "tiktok-account",
			WorkspaceID:     "workspace-1",
			Slug:            "tiktok",
			Platform:        "tiktok",
			AccountID:       "open-id",
			AccountUsername: "creator",
			AccessTokenEnc:  []byte("token"),
			IsActive:        true,
		},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Launch",
		ContentProfile:  models.ContentProfileShortVideo,
		SourceText:      "Launch",
		SourceContent:   "Launch",
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Rendition{
		{
			ID:              "youtube-rendition",
			PublicationID:   "publication-1",
			SocialAccountID: "youtube-account",
			Platform:        "youtube",
			Profile:         models.ContentProfileShortVideo,
			Body:            "old youtube",
			Title:           "Old title",
			SettingsJSON:    "{}",
			Status:          models.RenditionStatusDraft,
		},
		{
			ID:              "tiktok-rendition",
			PublicationID:   "publication-1",
			SocialAccountID: "tiktok-account",
			Platform:        "tiktok",
			Profile:         models.ContentProfileShortVideo,
			Body:            "old tiktok",
			Title:           "Old TikTok title",
			SettingsJSON:    "{}",
			Status:          models.RenditionStatusDraft,
		},
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	body := bytes.NewBufferString(`{"expected_revision":1,"renditions":[{"social_account_id":"youtube-account","profile":"short_video","body":"new youtube","title":"New title","description":"New description","settings":{"privacy":"private"}}]}`)
	req := httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/publications/publication-1/renditions", body)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var out PublicationResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	require.Len(t, out.Renditions, 2)
	require.Equal(t, "tiktok-account", out.Renditions[0].SocialAccountID)
	require.Equal(t, "youtube-account", out.Renditions[1].SocialAccountID)
	require.Equal(t, "new youtube", out.Renditions[1].Body)

	var persisted []models.Rendition
	require.NoError(t, db.NewSelect().Model(&persisted).Order("social_account_id ASC").Scan(ctx))
	require.Len(t, persisted, 2)
	require.Equal(t, "tiktok-account", persisted[0].SocialAccountID)
	require.Equal(t, "old tiktok", persisted[0].Body)
	require.Equal(t, "youtube-account", persisted[1].SocialAccountID)

	staleReq := httptest.NewRequestWithContext(
		ctx,
		http.MethodPut,
		"/api/v1/publications/publication-1/renditions",
		bytes.NewBufferString(`{"expected_revision":1,"renditions":[]}`),
	)
	staleReq.Header.Set("Authorization", "Bearer web-token")
	staleReq.Header.Set("Content-Type", "application/json")
	staleRec := httptest.NewRecorder()
	e.ServeHTTP(staleRec, staleReq)
	require.Equal(t, http.StatusConflict, staleRec.Code, staleRec.Body.String())
	var conflict struct {
		Code     string `json:"code"`
		Conflict struct {
			ExpectedRevision int      `json:"expected_revision"`
			CurrentRevision  int      `json:"current_revision"`
			ChangedDomains   []string `json:"changed_domains"`
		} `json:"conflict"`
	}
	require.NoError(t, json.Unmarshal(staleRec.Body.Bytes(), &conflict))
	require.Equal(t, "draft_revision_conflict", conflict.Code)
	require.Equal(t, 1, conflict.Conflict.ExpectedRevision)
	require.Equal(t, 2, conflict.Conflict.CurrentRevision)
	require.Contains(t, conflict.Conflict.ChangedDomains, "destination overrides")

	unconfirmedReq := httptest.NewRequestWithContext(ctx, http.MethodDelete, "/api/v1/publications/publication-1/renditions/youtube-account", nil)
	unconfirmedReq.Header.Set("Authorization", "Bearer web-token")
	unconfirmedRec := httptest.NewRecorder()
	e.ServeHTTP(unconfirmedRec, unconfirmedReq)
	require.Equal(t, http.StatusBadRequest, unconfirmedRec.Code, unconfirmedRec.Body.String())

	deleteReq := httptest.NewRequestWithContext(ctx, http.MethodDelete, "/api/v1/publications/publication-1/renditions/youtube-account?confirm=true&expected_revision=2", nil)
	deleteReq.Header.Set("Authorization", "Bearer web-token")
	deleteRec := httptest.NewRecorder()
	e.ServeHTTP(deleteRec, deleteReq)
	require.Equal(t, http.StatusOK, deleteRec.Code, deleteRec.Body.String())

	persisted = nil
	require.NoError(t, db.NewSelect().Model(&persisted).Order("social_account_id ASC").Scan(ctx))
	require.Len(t, persisted, 1)
	require.Equal(t, "tiktok-account", persisted[0].SocialAccountID)

	_, err = db.Exec(`
		CREATE TRIGGER fail_atomic_rendition_delete
		BEFORE DELETE ON renditions
		BEGIN
			SELECT RAISE(ABORT, 'forced rendition delete failure');
		END;
	`)
	require.NoError(t, err)
	rollbackReq := httptest.NewRequestWithContext(
		ctx,
		http.MethodPut,
		"/api/v1/publications/publication-1",
		bytes.NewBufferString(`{
			"expected_revision":3,
			"title":"This must roll back",
			"renditions":[{
				"social_account_id":"tiktok-account",
				"profile":"short_video",
				"body":"new tiktok",
				"title":"New TikTok title"
			}]
		}`),
	)
	rollbackReq.Header.Set("Authorization", "Bearer web-token")
	rollbackReq.Header.Set("Content-Type", "application/json")
	rollbackRec := httptest.NewRecorder()
	e.ServeHTTP(rollbackRec, rollbackReq)
	require.Equal(t, http.StatusInternalServerError, rollbackRec.Code, rollbackRec.Body.String())

	var rolledBack models.Publication
	require.NoError(t, db.NewSelect().Model(&rolledBack).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, "Launch", rolledBack.Title)
	require.Equal(t, 3, rolledBack.Revision)
	persisted = nil
	require.NoError(t, db.NewSelect().Model(&persisted).Where("publication_id = ?", "publication-1").Scan(ctx))
	require.Len(t, persisted, 1)
	require.Equal(t, "old tiktok", persisted[0].Body)
}

func TestReplacePublicationSegmentsKeepsDestinationOverridesForStableSegmentIDs(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
	)
	ctx := context.Background()
	now := time.Date(2026, time.July, 1, 9, 0, 0, 0, time.UTC)
	publication := &models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Launch",
		Intent:          "thread",
		ContentProfile:  models.ContentProfileThread,
		SourceText:      "First",
		SourceContent:   "First",
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err := db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationSegment{
		ID:            "segment-1",
		PublicationID: publication.ID,
		Position:      0,
		Body:          "First",
		SettingsJSON:  "{}",
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID:              "rendition-1",
		PublicationID:   publication.ID,
		SocialAccountID: "account-1",
		Platform:        "x",
		Profile:         models.ContentProfileThread,
		OutputProfile:   "x.thread",
		Body:            "Destination first",
		SettingsJSON:    "{}",
		Status:          models.RenditionStatusDraft,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.RenditionSegment{
		ID:                   "rendition-segment-1",
		RenditionID:          "rendition-1",
		PublicationSegmentID: "segment-1",
		Position:             0,
		Body:                 "Destination first",
		SettingsJSON:         `{"poll_options":"One\nTwo"}`,
		Status:               models.RenditionStatusDraft,
		CreatedAt:            now,
		UpdatedAt:            now,
	}).Exec(ctx)
	require.NoError(t, err)

	handler := NewPublicationHandler(db, testAuthenticator{}, nil)
	err = db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return handler.replacePublicationSegments(txCtx, tx, publication, []PublicationSegmentInput{{
			ID:   "segment-1",
			Body: "Updated first",
		}})
	})
	require.NoError(t, err)

	var canonical models.PublicationSegment
	require.NoError(t, db.NewSelect().Model(&canonical).Where("id = ?", "segment-1").Scan(ctx))
	require.Equal(t, "Updated first", canonical.Body)
	var destination models.RenditionSegment
	require.NoError(t, db.NewSelect().Model(&destination).Where("id = ?", "rendition-segment-1").Scan(ctx))
	require.Equal(t, "Destination first", destination.Body)
	require.JSONEq(t, `{"poll_options":"One\nTwo"}`, destination.SettingsJSON)
}

func TestRetryPublicationRenditionQueuesOnlySafeTransientFailures(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.Job)(nil),
		(*models.Post)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleEditor,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Retry",
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Retry",
		SourceContent:   "Retry",
		Status:          models.PublicationStatusFailed,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Rendition{
		{
			ID:              "transient-rendition",
			PublicationID:   "publication-1",
			SocialAccountID: "account-transient",
			Platform:        "x",
			Profile:         models.ContentProfileShortText,
			Body:            "Retry",
			Status:          models.RenditionStatusFailed,
			ErrorKind:       "rate_limited",
			ErrorRetryable:  true,
			ErrorAction:     "retry",
		},
		{
			ID:              "permanent-rendition",
			PublicationID:   "publication-1",
			SocialAccountID: "account-permanent",
			Platform:        "x",
			Profile:         models.ContentProfileShortText,
			Body:            "Edit first",
			Status:          models.RenditionStatusFailed,
			ErrorKind:       "validation",
			ErrorRetryable:  false,
			ErrorAction:     "edit",
		},
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	retryReq := httptest.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"/api/v1/publications/publication-1/renditions/account-transient/retry",
		nil,
	)
	retryReq.Header.Set("Authorization", "Bearer web-token")
	retryRec := httptest.NewRecorder()
	e.ServeHTTP(retryRec, retryReq)
	require.Equal(t, http.StatusOK, retryRec.Code, retryRec.Body.String())

	var transient models.Rendition
	require.NoError(t, db.NewSelect().Model(&transient).Where("id = ?", "transient-rendition").Scan(ctx))
	require.Equal(t, models.RenditionStatusScheduled, transient.Status)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Contains(t, jobs[0].Payload, `"rendition_id":"transient-rendition"`)

	permanentReq := httptest.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"/api/v1/publications/publication-1/renditions/account-permanent/retry",
		nil,
	)
	permanentReq.Header.Set("Authorization", "Bearer web-token")
	permanentRec := httptest.NewRecorder()
	e.ServeHTTP(permanentRec, permanentReq)
	require.Equal(t, http.StatusConflict, permanentRec.Code, permanentRec.Body.String())
	require.NoError(t, db.NewSelect().Model(&jobs).Scan(ctx))
	require.Len(t, jobs, 1)
}
