package handlers

import (
	"encoding/json"
	"fmt"
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

func TestPublicationCalendarPreservesAuthoredScheduleAndPublishedOccurrence(t *testing.T) {
	for _, backend := range []struct {
		name string
		open func(testing.TB, ...any) *bun.DB
	}{{"sqlite", createHandlerTestDB}, {"postgres", createHandlerPostgresTestDB}} {
		t.Run(backend.name, func(t *testing.T) {
			db := backend.open(t,
				(*models.WorkspaceMember)(nil), (*models.Publication)(nil),
				(*models.PublicationSegment)(nil), (*models.PublicationSegmentMedia)(nil),
				(*models.Rendition)(nil), (*models.RenditionMedia)(nil),
				(*models.RenditionSegment)(nil), (*models.RenditionSegmentMedia)(nil),
				(*models.MediaAttachment)(nil), (*models.ProviderDelivery)(nil),
			)
			ctx := t.Context()
			start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
			end := start.AddDate(0, 1, 0)
			outside := start.Add(-time.Hour)
			publications := make([]models.Publication, 0, 12)
			for _, entry := range []struct {
				id, status                 string
				scheduled, actual, updated time.Time
			}{
				{"a-scheduled", models.PublicationStatusScheduled, start, end, outside},
				{"b-publishing", models.PublicationStatusPublishing, start.Add(time.Hour), outside, outside},
				{"c-published-actual", models.PublicationStatusPublished, outside, start.Add(2 * time.Hour), outside},
				{"d-published-scheduled", models.PublicationStatusPublished, start.Add(3 * time.Hour), time.Time{}, outside},
				{"e-published-updated", models.PublicationStatusPublished, time.Time{}, time.Time{}, start.Add(4 * time.Hour)},
				{"f-tied-occurrence", models.PublicationStatusPublished, time.Time{}, start.Add(4 * time.Hour), outside},
				{"excluded-end", models.PublicationStatusPublished, start, end, outside},
				{"excluded-before", models.PublicationStatusPublished, start, outside, outside},
				{"excluded-unscheduled", models.PublicationStatusScheduled, time.Time{}, start, outside},
				{"excluded-draft", models.PublicationStatusDraft, start, start, start},
				{"excluded-failed", models.PublicationStatusFailed, start, start, start},
			} {
				publications = append(publications, models.Publication{
					ID: entry.id, WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: entry.id,
					SourceContent: "Source", SourceText: "Source", Status: entry.status,
					ScheduledAt: entry.scheduled, ActualRunAt: entry.actual, UpdatedAt: entry.updated, CreatedAt: outside,
				})
			}
			publications = append(publications, models.Publication{ID: "other-workspace", WorkspaceID: "workspace-2", CreatedByID: "user-1", Title: "Private", SourceContent: "Private", Status: models.PublicationStatusScheduled, ScheduledAt: start})
			_, err := db.NewInsert().Model(&publications).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
			require.NoError(t, err)
			e := echo.New()
			api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)
			var got []string
			for offset := 0; offset < 6; offset += 2 {
				path := fmt.Sprintf("/api/v1/publications?workspace_id=workspace-1&calendar_from=%s&calendar_before=%s&limit=2&offset=%d", start.Format(time.RFC3339), end.Format(time.RFC3339), offset)
				request := httptest.NewRequestWithContext(ctx, http.MethodGet, path, nil)
				request.Header.Set("Authorization", "Bearer web-token")
				response := httptest.NewRecorder()
				e.ServeHTTP(response, request)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				require.Equal(t, "6", response.Header().Get("X-Total-Count"))
				require.Equal(t, fmt.Sprint(offset+2), response.Header().Get("X-Next-Offset"))
				require.Equal(t, fmt.Sprint(offset < 4), response.Header().Get("X-Has-More"))
				var page []PublicationResponse
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
				got = append(got, publicationResponseIDs(page)...)
			}
			require.Equal(t, []string{"a-scheduled", "b-publishing", "c-published-actual", "d-published-scheduled", "e-published-updated", "f-tied-occurrence"}, got)
		})
	}
}
