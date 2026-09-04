package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

const (
	threadDraftPrefix    = "__openpost_thread__:"
	sampleThreadBlob     = threadDraftPrefix + `{"p":[{"k":"a","c":"first post","m":[]},{"k":"b","c":"second post","m":["m-1"]}],"v":{}}`
	threadDraftSelectSQL = "SELECT post_id, draft_json, created_at, updated_at FROM thread_drafts ORDER BY post_id"
)

func TestRunMigrationsMovesThreadDraftBlobsToThreadDraftsTable(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	// Seed: two posts with the legacy blob in content, one regular post.
	posts := []models.Post{
		{ID: "thread-1", WorkspaceID: "ws-1", CreatedByID: "u-1", Content: sampleThreadBlob, Status: models.PostStatusDraft},
		{ID: "thread-2", WorkspaceID: "ws-1", CreatedByID: "u-1", Content: sampleThreadBlob, Status: models.PostStatusScheduled},
		{ID: "single-1", WorkspaceID: "ws-1", CreatedByID: "u-1", Content: "Just a regular post", Status: models.PostStatusDraft},
	}
	_, err := db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)

	runMigrationsThrough(t, db)

	// Both thread parents must now have a thread_drafts row carrying the blob.
	var drafts []models.ThreadDraft
	require.NoError(t, db.NewSelect().Model(&drafts).Scan(ctx))
	require.Len(t, drafts, 2)
	draftByPost := make(map[string]string, len(drafts))
	for _, d := range drafts {
		draftByPost[d.PostID] = d.DraftJSON
	}
	require.Equal(t, sampleThreadBlob, draftByPost["thread-1"])
	require.Equal(t, sampleThreadBlob, draftByPost["thread-2"])

	// Their posts.content must be empty now.
	var reloaded []models.Post
	require.NoError(t, db.NewSelect().Model(&reloaded).Scan(ctx))
	contentByID := make(map[string]string, len(reloaded))
	for _, p := range reloaded {
		contentByID[p.ID] = p.Content
	}
	require.Equal(t, "", contentByID["thread-1"], "blob should be cleared from posts.content")
	require.Equal(t, "", contentByID["thread-2"], "blob should be cleared from posts.content")
	require.Equal(t, "Just a regular post", contentByID["single-1"], "non-thread posts must be untouched")
}

func TestRunMigrationsIsIdempotentForThreadDrafts(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	posts := []models.Post{
		{ID: "thread-1", WorkspaceID: "ws-1", CreatedByID: "u-1", Content: sampleThreadBlob, Status: models.PostStatusDraft},
	}
	_, err := db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)

	runMigrationsThrough(t, db)
	runMigrationsThrough(t, db)
	runMigrationsThrough(t, db)

	// Re-running the migration must not duplicate thread_drafts rows, and
	// must not change posts.content (which is now empty, and should stay empty).
	var drafts []models.ThreadDraft
	require.NoError(t, db.NewSelect().Model(&drafts).Scan(ctx))
	require.Len(t, drafts, 1, "thread_drafts should still have exactly one row for thread-1")
	require.Equal(t, sampleThreadBlob, drafts[0].DraftJSON)

	var p models.Post
	require.NoError(t, db.NewSelect().Model(&p).Where("id = ?", "thread-1").Scan(ctx))
	require.Equal(t, "", p.Content)
}
