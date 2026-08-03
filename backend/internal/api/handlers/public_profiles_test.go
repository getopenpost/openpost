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
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestPublicProfileReturnsOptInPublishingActivity(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
	)
	ctx := context.Background()
	now := time.Now().UTC()
	user := &models.User{
		ID: "user-1", Email: "rodrigo@example.com", Username: "rodrgds",
		DisplayName: "Rodrigo Dias", PublicProfile: true, CreatedAt: now.AddDate(-1, 0, 0),
	}
	workspace := &models.Workspace{ID: "workspace-1", Name: "OpenPost", CreatedAt: now}
	member := &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleAdmin}
	require.NoError(t, insertProfileRows(ctx, db, user, workspace, member))

	publications := []models.Publication{
		{ID: "publication-1", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "One", SourceContent: "One", Status: models.PublicationStatusPublished, ActualRunAt: now, UpdatedAt: now},
		{ID: "publication-2", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "Two", SourceContent: "Two", Status: models.PublicationStatusPublished, ActualRunAt: now.AddDate(0, 0, -1), UpdatedAt: now.AddDate(0, 0, -1)},
		{ID: "publication-3", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "Three", SourceContent: "Three", Status: models.PublicationStatusPublished, ActualRunAt: now.AddDate(0, 0, -3), UpdatedAt: now.AddDate(0, 0, -3)},
	}
	require.NoError(t, insertProfileRows(ctx, db, &publications))
	renditions := []models.Rendition{
		{ID: "rendition-1", PublicationID: "publication-1", Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished},
		{ID: "rendition-2", PublicationID: "publication-2", Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished},
		{ID: "rendition-3", PublicationID: "publication-3", Platform: "linkedin", Profile: "short_text", Status: models.RenditionStatusPublished},
	}
	require.NoError(t, insertProfileRows(ctx, db, &renditions))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicProfileHandler(db).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/profiles/rodrgds", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var profile PublicProfileOutput
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &profile.Body))
	require.Equal(t, "rodrgds", profile.Body.Username)
	require.Equal(t, 3, profile.Body.LifetimePosts)
	require.Equal(t, 2, profile.Body.CurrentStreak)
	require.Equal(t, 2, profile.Body.LongestStreak)
	require.Len(t, profile.Body.Activity, publicProfileActivityDays)
	require.Equal(t, PublicProfileRanking{Key: "x", Name: "x", Count: 2}, profile.Body.TopPlatforms[0])
	require.Equal(t, PublicProfileRanking{Key: workspace.ID, Name: "OpenPost", Count: 3}, profile.Body.TopWorkspaces[0])
}

func TestPublicProfileHidesOptedOutUser(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil))
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "private@example.com", Username: "private-user"}).Exec(context.Background())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicProfileHandler(db).RegisterRoutes(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/profiles/private-user", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
}

func insertProfileRows(ctx context.Context, db *bun.DB, rows ...interface{}) error {
	for _, row := range rows {
		if _, err := db.NewInsert().Model(row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
