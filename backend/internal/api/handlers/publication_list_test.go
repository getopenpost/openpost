package handlers

import (
	"context"
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
)

func TestValidatePublicationListInputAcceptsStableCursorAndRejectsMixedPagination(t *testing.T) {
	timestamp := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	input := &ListPublicationsInput{Cursor: encodeTimestampIDCursor(timestamp, "publication-1")}
	_, cursor, _, err := validatePublicationListInput(input)
	require.NoError(t, err)
	require.Equal(t, timestamp, cursor.Timestamp)
	require.Equal(t, "publication-1", cursor.ID)

	input.Offset = 1
	invalidLimit, invalidCursor, invalidRanges, err := validatePublicationListInput(input)
	require.Error(t, err)
	require.Zero(t, invalidLimit)
	require.Nil(t, invalidCursor)
	require.Equal(t, publicationListRange{}, invalidRanges)
}

func TestFailedPublicationCanBeDismissedAndRestoredWithoutDeletingEvidence(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Publication)(nil))
	ctx := t.Context()
	now := time.Date(2026, time.August, 27, 10, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Launch", SourceText: "Launch", SourceContent: "Launch",
		Status: models.PublicationStatusFailed, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	dismiss := httptest.NewRequestWithContext(
		ctx, http.MethodPost, "/api/v1/publications/publication-1/failure-dismissal", nil,
	)
	dismiss.Header.Set("Authorization", "Bearer web-token")
	dismissRec := httptest.NewRecorder()
	e.ServeHTTP(dismissRec, dismiss)
	require.Equal(t, http.StatusOK, dismissRec.Code, dismissRec.Body.String())

	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.False(t, publication.FailureDismissedAt.IsZero())
	require.Equal(t, models.PublicationStatusFailed, publication.Status)

	var failed []models.Publication
	input := &ListPublicationsInput{WorkspaceID: "workspace-1", ActivityBucket: "failed"}
	_, _, ranges, validateErr := validatePublicationListInput(input)
	require.NoError(t, validateErr)
	require.NoError(t, publicationListQuery(db, &failed, input, ranges).Scan(ctx))
	require.Empty(t, failed)

	restore := httptest.NewRequestWithContext(
		ctx, http.MethodDelete, "/api/v1/publications/publication-1/failure-dismissal", nil,
	)
	restore.Header.Set("Authorization", "Bearer web-token")
	restoreRec := httptest.NewRecorder()
	e.ServeHTTP(restoreRec, restore)
	require.Equal(t, http.StatusOK, restoreRec.Code, restoreRec.Body.String())

	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
	require.True(t, publication.FailureDismissedAt.IsZero())
	failed = nil
	require.NoError(t, publicationListQuery(db, &failed, input, ranges).Scan(ctx))
	require.Len(t, failed, 1)
}

func TestPublicationListCursorReachesOlderRecordsWithoutDuplicates(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.Publication)(nil), (*models.Rendition)(nil))
	createdAt := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	publications := make([]models.Publication, 0, 5)
	for _, id := range []string{"publication-a", "publication-b", "publication-c", "publication-d", "publication-e"} {
		publications = append(publications, models.Publication{
			ID: id, WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: id,
			ContentProfile: models.ContentProfileShortText, SourceText: id, SourceContent: id,
			Status: models.PublicationStatusDraft, CreatedAt: createdAt, UpdatedAt: createdAt,
		})
	}
	_, err := db.NewInsert().Model(&publications).Exec(context.Background())
	require.NoError(t, err)
	handler := &PublicationHandler{db: db}

	first, err := handler.listPublicationsPage(context.Background(), &ListPublicationsInput{
		WorkspaceID: "workspace-1", Limit: 2,
	})
	require.NoError(t, err)
	require.True(t, first.HasMore)
	require.NotEmpty(t, first.NextCursor)
	require.Equal(t, []string{"publication-e", "publication-d"}, publicationResponseIDs(first.Body))

	second, err := handler.listPublicationsPage(context.Background(), &ListPublicationsInput{
		WorkspaceID: "workspace-1", Limit: 2, Cursor: first.NextCursor,
	})
	require.NoError(t, err)
	require.True(t, second.HasMore)
	require.Equal(t, []string{"publication-c", "publication-b"}, publicationResponseIDs(second.Body))

	third, err := handler.listPublicationsPage(context.Background(), &ListPublicationsInput{
		WorkspaceID: "workspace-1", Limit: 2, Cursor: second.NextCursor,
	})
	require.NoError(t, err)
	require.False(t, third.HasMore)
	require.Empty(t, third.NextCursor)
	require.Equal(t, []string{"publication-a"}, publicationResponseIDs(third.Body))
}

func TestPublicationListSearchIsWorkspaceScopedAndCursorPaged(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.Publication)(nil), (*models.Rendition)(nil))
	createdAt := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	publications := make([]models.Publication, 0, 221)
	for index := range 220 {
		id := fmt.Sprintf("matching-%03d", index)
		publications = append(publications, models.Publication{
			ID: id, WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Launch note " + id,
			ContentProfile: models.ContentProfileShortText, SourceText: "Release", SourceContent: "Release",
			Status: models.PublicationStatusDraft, CreatedAt: createdAt, UpdatedAt: createdAt,
		})
	}
	publications = append(publications, models.Publication{
		ID: "other-workspace", WorkspaceID: "workspace-2", CreatedByID: "user-1", Title: "Launch note hidden",
		ContentProfile: models.ContentProfileShortText, SourceText: "Release", SourceContent: "Release",
		Status: models.PublicationStatusDraft, CreatedAt: createdAt, UpdatedAt: createdAt,
	})
	_, err := db.NewInsert().Model(&publications).Exec(context.Background())
	require.NoError(t, err)
	handler := &PublicationHandler{db: db}

	seen := map[string]struct{}{}
	cursor := ""
	for {
		page, err := handler.listPublicationsPage(context.Background(), &ListPublicationsInput{
			WorkspaceID: "workspace-1", Search: "launch NOTE", Limit: 43, Cursor: cursor,
		})
		require.NoError(t, err)
		for _, publication := range page.Body {
			require.NotContains(t, seen, publication.ID)
			seen[publication.ID] = struct{}{}
		}
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	require.Len(t, seen, 220)
	require.NotContains(t, seen, "other-workspace")
}

func publicationResponseIDs(publications []PublicationResponse) []string {
	ids := make([]string, 0, len(publications))
	for _, publication := range publications {
		ids = append(ids, publication.ID)
	}
	return ids
}
