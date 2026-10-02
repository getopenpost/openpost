package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
		(*models.Job)(nil),
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

	create := func(t *testing.T, body string) PublicationResponse {
		t.Helper()
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
	first := create(t, body)
	second := create(t, body)

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
	t.Run("joined source authorship survives canonical-only edits", func(t *testing.T) {
		_, err := db.NewInsert().Model(&models.SocialAccount{ID: "joined-account", WorkspaceID: "workspace-1", Slug: "linkedin", Platform: "linkedin", AccountID: "joined", AccountUsername: "joined", AccessTokenEnc: []byte("token"), IsActive: true}).Exec(ctx)
		require.NoError(t, err)
		for _, id := range []string{"media-first", "media-continuation", "media-custom"} {
			_, err := db.NewInsert().Model(&models.MediaAttachment{ID: id, WorkspaceID: "workspace-1", MimeType: "image/png", OriginalFilename: id + ".png", ProcessingStatus: "ready"}).Exec(ctx)
			require.NoError(t, err)
		}
		joinedBody := `{
			"workspace_id":"workspace-1","title":"Joined sources","source_text":"First","intent":"thread","content_profile":"thread",
			"segments":[{"id":"source-a","body":"First","media":[{"media_id":"media-first"}]},{"id":"source-b","body":"Inherited continuation","media":[{"media_id":"media-continuation"}]},{"id":"source-c","body":"Explicitly omitted","media":[{"media_id":"media-first"}]}],
			"renditions":[{"social_account_id":"joined-account","output_profile":"linkedin.post","segments":[{
				"publication_segment_id":"source-a",
				"source_overrides":[
					{"publication_segment_id":"source-a","body_override":"Independent first","media_inherited":false,"media":[{"media_id":"media-custom","alt_text":"Custom source image"}]},
					{"publication_segment_id":"source-b","media_inherited":true},
					{"publication_segment_id":"source-c","body_override":"","media_inherited":false,"media":[]}
				]
			}]}]
		}`
		joined := create(t, joinedBody)
		mixedRepeatedBody := strings.Replace(joinedBody, `"media_id":"media-continuation"`, `"media_id":"media-custom","alt_text":"Later inherited image","settings":{"audit":"later"}`, 1)
		mixedRepeatedBody = strings.Replace(mixedRepeatedBody, `"alt_text":"Custom source image"`, `"alt_text":"Custom source image","settings":{"audit":"first"}`, 1)
		inheritedRepeatedBody := strings.Replace(joinedBody, `"media_id":"media-continuation"`, `"media_id":"media-first","alt_text":"Later inherited image","settings":{"audit":"later"}`, 1)
		inheritedRepeatedBody = strings.Replace(inheritedRepeatedBody, `"media_id":"media-first"`, `"media_id":"media-first","alt_text":"Canonical first image","settings":{"audit":"first"}`, 1)
		inheritedRepeatedBody = strings.Replace(inheritedRepeatedBody, `"body_override":"Independent first","media_inherited":false,"media":[{"media_id":"media-custom","alt_text":"Custom source image"}]`, `"body_override":"Independent first","media_inherited":true`, 1)
		for _, repeated := range []struct {
			name, body, mediaID, altText string
			inherited                    bool
		}{
			{"mixed repeated media", mixedRepeatedBody, "media-custom", "Custom source image", false},
			{"inherited repeated media", inheritedRepeatedBody, "media-first", "Canonical first image", true},
			{"all inherited repeated media", strings.Replace(inheritedRepeatedBody, `"body_override":"","media_inherited":false,"media":[]`, `"body_override":"","media_inherited":true`, 1), "media-first", "Canonical first image", true},
		} {
			t.Run(repeated.name, func(t *testing.T) {
				post := create(t, repeated.body)
				require.Len(t, post.Segments[0].Media, 1)
				require.Len(t, post.Segments[1].Media, 1)
				output := post.Renditions[0].Segments[0]
				require.Len(t, output.Media, 1)
				require.Equal(t, repeated.mediaID, output.Media[0].ID)
				require.Equal(t, repeated.altText, output.Media[0].AltText)
				require.Equal(t, "first", output.Media[0].Settings["audit"])
				require.Len(t, output.SourceOverrides, 3)
				require.Equal(t, repeated.inherited, output.SourceOverrides[0].MediaInherited)
				if !repeated.inherited {
					require.Equal(t, repeated.mediaID, output.SourceOverrides[0].Media[0].MediaID)
				}
				sources := []map[string]any{
					{"id": post.Segments[0].ID, "body": "Changed first", "media": []map[string]any{{"media_id": "media-first", "alt_text": repeated.altText, "settings": map[string]any{"audit": "first"}}}},
					{"id": post.Segments[1].ID, "body": "Changed second", "media": []map[string]any{{"media_id": repeated.mediaID, "alt_text": "Later replacement image", "settings": map[string]any{"audit": "later"}}}},
					{"id": post.Segments[2].ID, "body": "Omitted", "media": []map[string]any{}},
				}
				payload, err := json.Marshal(map[string]any{"expected_revision": post.Revision, "segments": sources})
				require.NoError(t, err)
				req := httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/publications/"+post.ID, bytes.NewReader(payload))
				req.Header.Set("Authorization", "Bearer web-token")
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				e.ServeHTTP(rec, req)
				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
				var updated PublicationResponse
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &updated))
				require.Len(t, updated.Segments[0].Media, 1)
				require.Len(t, updated.Segments[1].Media, 1)
				output = updated.Renditions[0].Segments[0]
				require.Len(t, output.Media, 1)
				require.Equal(t, repeated.mediaID, output.Media[0].ID)
				require.Equal(t, repeated.altText, output.Media[0].AltText)
				require.Equal(t, "first", output.Media[0].Settings["audit"])
				require.Len(t, output.SourceOverrides, 3)
			})
		}
		require.Len(t, joined.Renditions[0].Segments, 1)
		segment := joined.Renditions[0].Segments[0]
		require.Equal(t, "Independent first\n\nInherited continuation", segment.Body)
		require.Len(t, segment.Media, 2)
		require.Equal(t, []string{"media-custom", "media-continuation"}, []string{segment.Media[0].ID, segment.Media[1].ID})
		require.Equal(t, "Custom source image", segment.Media[0].AltText)
		require.Len(t, segment.SourceOverrides, 3)
		require.Equal(t, joined.Segments[1].ID, segment.SourceOverrides[1].PublicationSegmentID)
		require.Nil(t, segment.SourceOverrides[1].BodyOverride)
		require.NotNil(t, segment.SourceOverrides[2].BodyOverride)
		require.Empty(t, *segment.SourceOverrides[2].BodyOverride)
		require.False(t, segment.SourceOverrides[2].MediaInherited)
		updatedSources := []map[string]any{
			{"id": joined.Segments[0].ID, "body": "Changed shared first", "media": []map[string]any{{"media_id": "media-first"}}},
			{"id": joined.Segments[1].ID, "body": "Changed continuation", "media": []map[string]any{}},
			{"id": joined.Segments[2].ID, "body": "Still omitted", "media": []map[string]any{{"media_id": "media-first"}}},
		}
		payload, err := json.Marshal(map[string]any{"expected_revision": joined.Revision, "segments": updatedSources})
		require.NoError(t, err)
		req := httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/publications/"+joined.ID, bytes.NewReader(payload))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var edited PublicationResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &edited))
		require.Equal(t, "Independent first\n\nChanged continuation", edited.Renditions[0].Segments[0].Body)
		require.Equal(t, "Independent first\n\nChanged continuation", *edited.Renditions[0].Segments[0].BodyOverride)
		require.Len(t, edited.Renditions[0].Segments, 1)
		require.Len(t, edited.Renditions[0].Segments[0].Media, 1)
		require.Equal(t, "media-custom", edited.Renditions[0].Segments[0].Media[0].ID)
		updatedSources[1]["media"] = []map[string]any{{"media_id": "media-first", "alt_text": "Replacement inherited image"}}
		payload, err = json.Marshal(map[string]any{"expected_revision": edited.Revision, "segments": updatedSources})
		require.NoError(t, err)
		req = httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/publications/"+joined.ID, bytes.NewReader(payload))
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		rec = httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &edited))
		require.Len(t, edited.Renditions[0].Segments[0].Media, 2)
		require.Equal(t, "media-custom", edited.Renditions[0].Segments[0].Media[0].ID)
		require.Equal(t, "media-first", edited.Renditions[0].Segments[0].Media[1].ID)
		require.Equal(t, "Replacement inherited image", edited.Renditions[0].Segments[0].Media[1].AltText)
		var aggregate []models.RenditionMedia
		require.NoError(t, db.NewSelect().Model(&aggregate).Where("rendition_id = ?", edited.Renditions[0].ID).Order("display_order ASC").Scan(ctx))
		require.Len(t, aggregate, 2)
		require.Equal(t, []string{"media-custom", "media-first"}, []string{aggregate[0].MediaID, aggregate[1].MediaID})
		_, err = db.NewInsert().Model(&models.MediaAttachment{ID: "foreign-media", WorkspaceID: "other-workspace", MimeType: "image/png", OriginalFilename: "foreign.png", ProcessingStatus: "ready"}).Exec(ctx)
		require.NoError(t, err)
		for _, invalid := range []struct {
			name, body, message string
		}{
			{"unknown source", strings.Replace(joinedBody, `"publication_segment_id":"source-b"`, `"publication_segment_id":"unknown"`, 1), "source override does not match a canonical publication segment"},
			{"duplicate source", strings.Replace(joinedBody, `"publication_segment_id":"source-b"`, `"publication_segment_id":"source-a"`, 1), "each joined source may appear only once"},
			{"independent foreign media", strings.Replace(joinedBody, `"media_id":"media-custom"`, `"media_id":"foreign-media"`, 1), "outside this workspace"},
		} {
			t.Run(invalid.name, func(t *testing.T) {
				req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/publications", strings.NewReader(invalid.body))
				req.Header.Set("Authorization", "Bearer web-token")
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				e.ServeHTTP(rec, req)
				require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
				require.Contains(t, rec.Body.String(), invalid.message)
			})
		}
	})

}

func TestDeletePublicationRequiresConfirmationAndRevision(t *testing.T) {
	for _, status := range []string{models.PublicationStatusDraft, models.PublicationStatusPublished} {
		t.Run(status, func(t *testing.T) {
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
				Status:          status,
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
		})
	}
}
