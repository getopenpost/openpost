package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"

	"github.com/stretchr/testify/require"
)

func TestBatchScheduleKeepsSeriesApartAndCommitsOnlyCurrentItems(t *testing.T) {
	t.Parallel()
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
