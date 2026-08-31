package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
)

type publicationAPITokenAuthenticator struct{}

func (publicationAPITokenAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	if token != "token-one" && token != "token-two" {
		return nil, apitokens.ErrInvalidToken
	}
	return &middleware.Principal{
		UserID: "user-1", Scope: apitokens.ScopeAPIWrite,
		WorkspaceID: "workspace-1", TokenID: token,
	}, nil
}

func createIdempotencyRecordTable(t *testing.T, db interface {
	ExecContext(context.Context, string, ...interface{}) (sql.Result, error)
}) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `
		CREATE TABLE idempotency_records (
			id TEXT PRIMARY KEY,
			principal_id TEXT NOT NULL,
			workspace_id TEXT NOT NULL,
			operation_id TEXT NOT NULL,
			idempotency_key TEXT NOT NULL,
			request_hash TEXT NOT NULL,
			state TEXT NOT NULL,
			http_status INTEGER NOT NULL DEFAULT 0,
			response_json TEXT NOT NULL DEFAULT '',
			resource_id TEXT NOT NULL DEFAULT '',
			job_id TEXT NOT NULL DEFAULT '',
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP NOT NULL,
			completed_at TIMESTAMP
		);
		CREATE UNIQUE INDEX idempotency_records_scope_key_idx
		ON idempotency_records (principal_id, workspace_id, operation_id, idempotency_key);
	`)
	require.NoError(t, err)
}

func TestCreatePublicationIdempotencyReplaysConflictsAndIsolatesTokens(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil),
	)
	createIdempotencyRecordTable(t, db)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, publicationAPITokenAuthenticator{}, nil).RegisterRoutes(api)
	body := `{"workspace_id":"workspace-1","title":"Original title","content_profile":"short_text","source_text":"Hello"}`
	create := func(token, key, requestBody string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/publications", bytes.NewBufferString(requestBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}

	first := create("token-one", "upstream-event-1", body)
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	var firstPublication PublicationResponse
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstPublication))

	_, err = db.NewUpdate().Model((*models.Publication)(nil)).
		Set("title = ?", "Changed after request").
		Where("id = ?", firstPublication.ID).Exec(t.Context())
	require.NoError(t, err)

	replay := create("token-one", "upstream-event-1", body)
	require.Equal(t, http.StatusOK, replay.Code, replay.Body.String())
	var replayedPublication PublicationResponse
	require.NoError(t, json.Unmarshal(replay.Body.Bytes(), &replayedPublication))
	require.Equal(t, firstPublication, replayedPublication)
	require.Equal(t, "Original title", replayedPublication.Title)

	conflict := create("token-one", "upstream-event-1", `{"workspace_id":"workspace-1","title":"Different","content_profile":"short_text","source_text":"Hello"}`)
	require.Equal(t, http.StatusConflict, conflict.Code, conflict.Body.String())

	otherToken := create("token-two", "upstream-event-1", body)
	require.Equal(t, http.StatusOK, otherToken.Code, otherToken.Body.String())
	var otherPublication PublicationResponse
	require.NoError(t, json.Unmarshal(otherToken.Body.Bytes(), &otherPublication))
	require.NotEqual(t, firstPublication.ID, otherPublication.ID)

	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, count)
}

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
