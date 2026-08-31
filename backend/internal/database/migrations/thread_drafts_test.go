package migrations

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

const (
	threadDraftPrefix    = "__openpost_thread__:"
	sampleThreadBlob     = threadDraftPrefix + `{"p":[{"k":"a","c":"first post","m":[]},{"k":"b","c":"second post","m":["m-1"]}],"v":{}}`
	threadDraftSelectSQL = "SELECT post_id, draft_json, created_at, updated_at FROM thread_drafts ORDER BY post_id"
)

func newMigrationsTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)

	// Match production: single connection so PRAGMA settings (foreign
	// keys, busy_timeout, journal mode) are reliably visible to every
	// subsequent statement on this DB.
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())

	// Match production: enable foreign keys so cascade constraints work
	// in tests as they would in the real binary.
	_, err = db.Exec("PRAGMA foreign_keys=ON")
	require.NoError(t, err)

	modelList := []interface{}{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.ThreadDraft)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
	}
	for _, m := range modelList {
		_, err := db.NewCreateTable().Model(m).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}

	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

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

	runMigrationsThrough(t, db, 7)

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

	runMigrationsThrough(t, db, 7)
	runMigrationsThrough(t, db, 7)
	runMigrationsThrough(t, db, 7)

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

func TestRunMigrationsHandlesEmptyPostsTable(t *testing.T) {
	t.Parallel()

	// No posts in the table, no thread_drafts yet. The migration should
	// just create the empty thread_drafts table and exit cleanly.
	db := newMigrationsTestDB(t)
	ctx := context.Background()

	runMigrationsThrough(t, db, 7)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("thread_drafts").Scan(ctx, &count))
	require.Equal(t, 0, count)
}

func TestRunMigrationsThreadDraftsForeignKeyOnDeleteCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	posts := []models.Post{
		{ID: "thread-1", WorkspaceID: "ws-1", CreatedByID: "u-1", Content: sampleThreadBlob, Status: models.PostStatusDraft},
	}
	_, err := db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)

	runMigrationsThrough(t, db, 7)

	_, err = db.ExecContext(ctx, "DELETE FROM posts WHERE id = ?", "thread-1")
	require.NoError(t, err)

	var drafts []models.ThreadDraft
	require.NoError(t, db.NewSelect().Model(&drafts).Scan(ctx))
	require.Len(t, drafts, 0, "deleting the parent post should cascade to its thread_drafts row")
}
