package handlers

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

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
