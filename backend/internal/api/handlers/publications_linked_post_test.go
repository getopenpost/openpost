package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestLinkedTextPostIDReturnsTheTextComposerDraft(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Post)(nil))
	ctx := context.Background()
	now := time.Date(2026, time.July, 25, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.Post{
		ID:            "post-1",
		PublicationID: "publication-1",
		WorkspaceID:   "workspace-1",
		CreatedByID:   "user-1",
		Content:       "Draft with a link",
		Status:        models.PostStatusDraft,
		Revision:      1,
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Exec(ctx)
	require.NoError(t, err)

	postID, err := linkedTextPostID(ctx, db, "publication-1")
	require.NoError(t, err)
	require.Equal(t, "post-1", postID)

	postID, err = linkedTextPostID(ctx, db, "publication-without-post")
	require.NoError(t, err)
	require.Empty(t, postID)
}
