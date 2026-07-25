package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCreatePublicationReplacesClientPlaceholderSegmentIDs(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.MediaAttachment)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:              "account-1",
		WorkspaceID:     "workspace-1",
		Slug:            "x",
		Platform:        "x",
		AccountID:       "account",
		AccountUsername: "account",
		AccessTokenEnc:  []byte("token"),
		IsActive:        true,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	create := func(body string) PublicationResponse {
		req := httptest.NewRequestWithContext(
			ctx,
			http.MethodPost,
			"/api/v1/publications",
			bytes.NewBufferString(body),
		)
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var out PublicationResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
		return out
	}

	body := `{
		"workspace_id":"workspace-1",
		"title":"Story draft",
		"intent":"story",
		"content_profile":"story",
		"source_text":"Caption",
		"segments":[{"id":"segment-1","body":"Caption"}],
		"renditions":[{
			"social_account_id":"account-1",
			"profile":"story",
			"output_profile":"x.story",
			"segments":[{"publication_segment_id":"segment-1","body":"Caption"}]
		}]
	}`
	first := create(body)
	second := create(body)

	require.Len(t, first.Segments, 1)
	require.Len(t, second.Segments, 1)
	require.NotEqual(t, "segment-1", first.Segments[0].ID)
	require.NotEqual(t, first.Segments[0].ID, second.Segments[0].ID)
	require.Len(t, first.Renditions, 1)
	require.Len(t, first.Renditions[0].Segments, 1)
	require.Equal(
		t,
		first.Segments[0].ID,
		first.Renditions[0].Segments[0].PublicationSegmentID,
	)
}

func TestDeletePublicationRequiresConfirmationAndRevision(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Job)(nil),
	)
	ctx := context.Background()
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
		Title:           "Story draft",
		Intent:          "story",
		ContentProfile:  "story",
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    "{}",
		ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	unconfirmed := httptest.NewRequestWithContext(
		ctx,
		http.MethodDelete,
		"/api/v1/publications/publication-1",
		nil,
	)
	unconfirmed.Header.Set("Authorization", "Bearer web-token")
	unconfirmedRec := httptest.NewRecorder()
	e.ServeHTTP(unconfirmedRec, unconfirmed)
	require.Equal(t, http.StatusBadRequest, unconfirmedRec.Code, unconfirmedRec.Body.String())

	confirmed := httptest.NewRequestWithContext(
		ctx,
		http.MethodDelete,
		"/api/v1/publications/publication-1?confirm=true&expected_revision=1",
		nil,
	)
	confirmed.Header.Set("Authorization", "Bearer web-token")
	confirmedRec := httptest.NewRecorder()
	e.ServeHTTP(confirmedRec, confirmed)
	require.Equal(t, http.StatusOK, confirmedRec.Code, confirmedRec.Body.String())

	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}
