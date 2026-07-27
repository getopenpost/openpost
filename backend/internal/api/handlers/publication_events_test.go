package handlers

import (
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
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/stretchr/testify/require"
)

func TestListPublicationEventsReturnsLifecycleEvents(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.PublicationLifecycleEvent)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Events"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:             "publication-1",
		WorkspaceID:    "ws-1",
		CreatedByID:    "user-1",
		Title:          "Launch",
		ContentProfile: models.ContentProfileShortText,
		SourceText:     "Launch",
		SourceContent:  "Launch",
		Status:         models.PublicationStatusPublished,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = lifecycle.NewService(db).Record(ctx, lifecycle.EventInput{
		WorkspaceID:   "ws-1",
		PublicationID: "publication-1",
		RenditionID:   "rendition-1",
		Type:          lifecycle.EventPublished,
		Status:        lifecycle.StatusSucceeded,
		Message:       "rendition published",
		Metadata:      map[string]any{"platform": "x"},
	})
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, entitlements.NewSelfHostedService()).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/publications/publication-1/events", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()

	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var events []PublicationLifecycleEventResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &events))
	require.Len(t, events, 1)
	require.Equal(t, lifecycle.EventPublished, events[0].Type)
	require.Equal(t, "x", events[0].Metadata["platform"])
	require.WithinDuration(t, time.Now().UTC(), mustParseEventTime(t, events[0].CreatedAt), time.Minute)
}

func mustParseEventTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	require.NoError(t, err)
	return parsed
}
