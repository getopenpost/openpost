package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestSaveTextPostDraftCompareAndSetIsAtomicAndPermissionScoped(t *testing.T) {
	db := createHandlerTestDB(
		t,
		(*models.WorkspaceMember)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.ThreadDraft)(nil),
		(*models.MediaAttachment)(nil),
		(*models.SocialAccount)(nil),
		(*models.SocialSet)(nil),
		(*models.SocialSetAccount)(nil),
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
	now := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleEditor,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialSet{
		ID: "social-set-1", WorkspaceID: "workspace-1", Name: "Launch",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "publication-1",
		WorkspaceID:     "workspace-1",
		CreatedByID:     "user-1",
		Title:           "Original",
		Intent:          models.PublishingIntentPost,
		ContentProfile:  models.ContentProfileShortText,
		SourceText:      "Original",
		SourceContent:   "Original",
		Status:          models.PublicationStatusDraft,
		Revision:        1,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationSegment{
		ID:            "segment-1",
		PublicationID: "publication-1",
		Body:          "Original",
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID:            "post-1",
		WorkspaceID:   "workspace-1",
		CreatedByID:   "user-1",
		PublicationID: "publication-1",
		Content:       "Original",
		Status:        models.PostStatusDraft,
		Revision:      1,
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	postHandler := NewPostHandler(db, testAuthenticator{})
	postHandler.CreateTextPostDraft(api)
	postHandler.SaveTextPostDraft(api)

	save := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(
			ctx,
			http.MethodPut,
			"/api/v1/posts/post-1/draft",
			strings.NewReader(body),
		)
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}

	success := save(`{
		"expected_revision": 1,
		"content": "Updated",
		"social_account_ids": [],
		"media_ids": [],
		"variants": [],
		"publication": {
			"title": "Updated title",
			"creation_preset": "thread",
			"social_set_id": "social-set-1",
			"source_text": "Updated",
			"repost_override": {"mode": "off"},
			"segments": [{"body": "Updated"}],
			"renditions": []
		}
	}`)
	require.Equal(t, http.StatusOK, success.Code, success.Body.String())
	var output SaveTextPostDraftOutput
	require.NoError(t, json.Unmarshal(success.Body.Bytes(), &output.Body))
	require.Equal(t, 2, output.Body.Revision)

	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-1").Scan(ctx))
	require.Equal(t, "Updated", post.Content)
	require.Equal(t, 2, post.Revision)
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, "Updated title", publication.Title)
	require.Equal(t, models.PublishingIntentThread, publication.CreationPreset)
	require.Equal(t, "social-set-1", publication.SocialSetID)
	require.JSONEq(t, `{"mode":"off"}`, publication.RepostOverride)
	require.Equal(t, 2, publication.Revision)

	createRequest := httptest.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"/api/v1/posts/draft",
		strings.NewReader(`{
			"workspace_id": "workspace-1",
			"content": "Created through the clean composer",
			"social_account_ids": [],
			"media_ids": [],
			"variants": [],
			"publication": {
				"title": "Created through the clean composer",
				"creation_preset": "thread",
				"social_set_id": "social-set-1",
				"source_text": "Created through the clean composer",
				"segments": [{"body": "Created through the clean composer"}],
				"renditions": []
			}
		}`),
	)
	createRequest.Header.Set("Authorization", "Bearer web-token")
	createRequest.Header.Set("Content-Type", "application/json")
	createResponse := httptest.NewRecorder()
	e.ServeHTTP(createResponse, createRequest)
	require.Equal(t, http.StatusOK, createResponse.Code, createResponse.Body.String())
	var createdOutput CreateTextPostDraftOutput
	require.NoError(t, json.Unmarshal(createResponse.Body.Bytes(), &createdOutput.Body))
	var createdPublication models.Publication
	require.NoError(t, db.NewSelect().Model(&createdPublication).
		Where("id = ?", createdOutput.Body.PublicationID).
		Scan(ctx))
	require.Equal(t, models.PublishingIntentThread, createdPublication.CreationPreset)
	require.Equal(t, "social-set-1", createdPublication.SocialSetID)

	stale := save(`{
		"expected_revision": 1,
		"content": "Stale",
		"social_account_ids": [],
		"media_ids": [],
		"variants": [],
		"publication": {}
	}`)
	require.Equal(t, http.StatusConflict, stale.Code, stale.Body.String())
	var conflict struct {
		Code     string `json:"code"`
		Conflict struct {
			CurrentRevision int      `json:"current_revision"`
			ChangedDomains  []string `json:"changed_domains"`
		} `json:"conflict"`
	}
	require.NoError(t, json.Unmarshal(stale.Body.Bytes(), &conflict))
	require.Equal(t, "draft_revision_conflict", conflict.Code)
	require.Equal(t, 2, conflict.Conflict.CurrentRevision)
	require.Contains(t, conflict.Conflict.ChangedDomains, "content")
	require.NotContains(t, stale.Body.String(), "Updated title")

	_, err = db.Exec(`
		CREATE TRIGGER fail_text_draft_segment_replace
		BEFORE INSERT ON publication_segments
		WHEN NEW.publication_id = 'publication-1'
		BEGIN
			SELECT RAISE(ABORT, 'forced atomic save failure');
		END;
	`)
	require.NoError(t, err)
	rollback := save(`{
		"expected_revision": 2,
		"content": "Must roll back",
		"social_account_ids": [],
		"media_ids": [],
		"variants": [],
		"publication": {
			"title": "Must roll back",
			"segments": [{"body": "Must roll back"}]
		}
	}`)
	require.Equal(t, http.StatusInternalServerError, rollback.Code, rollback.Body.String())
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-1").Scan(ctx))
	require.Equal(t, "Updated", post.Content)
	require.Equal(t, 2, post.Revision)
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.Equal(t, "Updated title", publication.Title)
	require.Equal(t, 2, publication.Revision)

	_, err = db.NewUpdate().
		Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "workspace-1", "user-1").
		Exec(ctx)
	require.NoError(t, err)
	forbidden := save(`{
		"expected_revision": 2,
		"content": "Viewer edit",
		"social_account_ids": [],
		"media_ids": [],
		"variants": [],
		"publication": {}
	}`)
	require.Equal(t, http.StatusForbidden, forbidden.Code, forbidden.Body.String())
}
