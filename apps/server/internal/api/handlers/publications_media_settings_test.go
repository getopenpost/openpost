package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
)

func TestPublicationMediaSettingsPersistAsObjects(t *testing.T) {
	for _, transport := range []string{"mcp", "rest_omitted", "rest_null", "rest_object", "rest_authored"} {
		t.Run(transport, func(t *testing.T) {
			srv := newMCPTestServer(t)
			_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
				ID: "video-342", WorkspaceID: "ws-1", MimeType: "video/mp4", Size: 1024,
				Width: 1080, Height: 1920, ProcessingStatus: "ready", OriginalFilename: "video.mp4",
			}).Exec(t.Context())
			require.NoError(t, err)
			media := map[string]any{"media_id": "video-342", "thumbnail_timestamp_ms": 1000}
			if transport == "rest_null" {
				media["settings"] = nil
			}
			if transport == "rest_object" {
				media["settings"] = map[string]any{}
			}
			if transport == "rest_authored" {
				media["settings"] = map[string]any{"crop": "portrait"}
			}
			body := map[string]any{
				"workspace_id": "ws-1", "title": "Video", "content_profile": "short_video", "source_text": "Video",
				"social_account_ids": []string{"account-1"}, "media": []any{media},
			}
			if transport == "mcp" {
				mcpRequireToolSuccess(t, srv, "issue342-create", "create_post", body)
			} else {
				api := humaecho.NewV4WithGroup(srv.echo, srv.echo.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
				NewPublicationHandler(srv.db, testAuthenticator{}, nil).RegisterRoutes(api)
				data, err := json.Marshal(body)
				require.NoError(t, err)
				req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/publications", bytes.NewReader(data))
				req.Header.Set("Authorization", "Bearer web-token")
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				srv.echo.ServeHTTP(rec, req)
				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			}
			var canonical []models.PublicationSegmentMedia
			var destination []models.RenditionSegmentMedia
			require.NoError(t, srv.db.NewSelect().Model(&canonical).Scan(t.Context()))
			require.NoError(t, srv.db.NewSelect().Model(&destination).Scan(t.Context()))
			require.Len(t, canonical, 1)
			require.Len(t, destination, 1)
			want := "{}"
			if transport == "rest_authored" {
				want = `{"crop":"portrait"}`
			}
			require.Equal(t, want, canonical[0].SettingsJSON)
			require.Equal(t, want, destination[0].SettingsJSON)
			require.Equal(t, 1000, destination[0].ThumbnailTimestampMS)
		})
	}
}

func TestFailedPublicationDeletionPreservesProtectedDeliveries(t *testing.T) {
	for _, state := range []string{"unsent", providerwrite.StatusSending, providerwrite.StatusAmbiguous, providerwrite.StatusAccepted} {
		t.Run(state, func(t *testing.T) {
			srv := newMCPTestServer(t)
			commands := srv.handler.publicationHandler().publicationApplication()
			publication, err := commands.Create(t.Context(), "user-1", CreatePublicationBody{
				WorkspaceID: "ws-1", ContentProfile: "short_text", SourceText: "Failed before upload",
				SocialAccountIDs: []string{"account-1"},
			})
			require.NoError(t, err)
			_, err = srv.db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusFailed).Where("id = ?", publication.ID).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewUpdate().Model((*models.Rendition)(nil)).Set("status = ?", models.RenditionStatusFailed).Where("publication_id = ?", publication.ID).Exec(t.Context())
			require.NoError(t, err)
			if state != "unsent" {
				job, err := jobregistry.NewJob(jobTypePublishPublication, mustJSON(map[string]string{"publication_id": publication.ID}), time.Now().UTC())
				require.NoError(t, err)
				job.Status = "failed"
				job.ScopeID = publication.ID
				_, err = srv.db.NewInsert().Model(job).Exec(t.Context())
				require.NoError(t, err)
				_, err = srv.db.NewInsert().Model(&models.ProviderWriteAttempt{ID: "protected-attempt", JobID: job.ID, Status: state}).Exec(t.Context())
				require.NoError(t, err)
			}
			err = commands.Delete(t.Context(), "user-1", publication.ID, publication.Revision)
			if state == "unsent" {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, errPublicationAlreadyProcessing)
			}
			exists, err := srv.db.NewSelect().Model((*models.Publication)(nil)).Where("id = ?", publication.ID).Exists(t.Context())
			require.NoError(t, err)
			require.Equal(t, state != "unsent", exists)
		})
	}
}
