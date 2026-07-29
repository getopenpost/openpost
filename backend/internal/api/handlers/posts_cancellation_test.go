package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

// createJobsTestDB is a minimal in-memory SQLite + bun setup used only by
// the post-cancellation regression tests below. It mirrors the schema
// subset of the real jobs table that the cancellation query depends on.
func createJobsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.NewCreateTable().Model((*models.Job)(nil)).IfNotExists().Exec(context.Background())
	require.NoError(t, err)
	return db
}

// TestCancelJobsForPostOnlyAffectsPublishPost is a regression test for the
// payload-LIKE cancellation bug (P0.1). The previous implementation used
// `WHERE payload LIKE '%<post.ID>%'`, which would match any job payload
// that contained the post ID as a substring (e.g. a media_cleanup job
// that referenced the post in a free-text `note` field). The fix is to
// filter on `type = 'publish_post'` AND the JSON `post_id` key so only
// the publish_post job for the target post is
// cancelled, no matter what other job types exist or what fields they
// put in their payloads.
func TestCancelJobsForPostOnlyAffectsPublishPost(t *testing.T) {
	t.Parallel()
	db := createJobsTestDB(t)
	ctx := context.Background()

	postID := "550e8400-e29b-41d4-a716-446655440000"
	otherPostID := "11111111-2222-3333-4444-555555555555"

	// The job that SHOULD be cancelled: a publish_post job whose payload
	// has a top-level "post_id" key matching postID.
	targetJob := &models.Job{
		ID:       uuid.NewString(),
		Type:     jobTypePublishPost,
		Payload:  fmt.Sprintf(`{"post_id":%q}`, postID),
		Status:   "pending",
		RunAt:    time.Now().Add(time.Hour),
		Attempts: 0,
	}

	// A publish_post job for a different post — must NOT be cancelled.
	otherPostJob := &models.Job{
		ID:       uuid.NewString(),
		Type:     jobTypePublishPost,
		Payload:  fmt.Sprintf(`{"post_id":%q}`, otherPostID),
		Status:   "pending",
		RunAt:    time.Now().Add(time.Hour),
		Attempts: 0,
	}

	// A decoy job whose payload embeds the target post ID in a
	// non-post_id field. The old LIKE-based query would have matched
	// this one; the new query must not.
	decoyWithSubstring := &models.Job{
		ID:       uuid.NewString(),
		Type:     "media_cleanup",
		Payload:  fmt.Sprintf(`{"workspace_id":"ws-1","note":"clean up media for post %s"}`, postID),
		Status:   "pending",
		RunAt:    time.Now().Add(time.Hour),
		Attempts: 0,
	}

	// A decoy job that is a publish_post for a different post whose ID
	// happens to start with the same 8 characters as postID. The old
	// LIKE-based query would have matched (substring match); the new
	// JSON-key query must not.
	decoySimilarPost := &models.Job{
		ID:       uuid.NewString(),
		Type:     jobTypePublishPost,
		Payload:  fmt.Sprintf(`{"post_id":"%s-extra"}`, postID[:8]),
		Status:   "pending",
		RunAt:    time.Now().Add(time.Hour),
		Attempts: 0,
	}

	// A hypothetical future job type that does include a `post_id` field
	// in its payload. Even with the JSON-key fix, this would still be
	// matched by the JSON-key condition alone — but the `type = ?` filter
	// explicitly excludes it, which is the contract we want to pin.
	decoyNonPublishWithPostID := &models.Job{
		ID:       uuid.NewString(),
		Type:     "refresh_token",
		Payload:  fmt.Sprintf(`{"account_id":"acc-1","post_id":%q}`, postID),
		Status:   "pending",
		RunAt:    time.Now().Add(time.Hour),
		Attempts: 0,
	}

	for _, j := range []*models.Job{targetJob, otherPostJob, decoyWithSubstring, decoySimilarPost, decoyNonPublishWithPostID} {
		_, err := db.NewInsert().Model(j).Exec(ctx)
		require.NoError(t, err)
	}

	// This is the EXACT query used in posts.go. If the production code
	// drifts from this string, the test stops being a regression test;
	// keep them in sync deliberately.
	res, err := db.NewDelete().
		Model(&models.Job{}).
		Where(publishPostJobPostIDWhere(db), jobTypePublishPost, postID).
		Exec(ctx)
	require.NoError(t, err)
	rowsAffected, err := res.RowsAffected()
	require.NoError(t, err)
	require.Equal(t, int64(1), rowsAffected, "expected exactly one job cancelled (the publish_post for the target post)")

	var remaining []models.Job
	err = db.NewSelect().Model(&remaining).OrderExpr("id ASC").Scan(ctx)
	require.NoError(t, err)
	require.Len(t, remaining, 4)

	ids := map[string]bool{}
	for _, j := range remaining {
		ids[j.ID] = true
	}
	require.False(t, ids[targetJob.ID], "target job should have been deleted")
	require.True(t, ids[otherPostJob.ID], "unrelated publish_post job must remain")
	require.True(t, ids[decoyWithSubstring.ID], "media_cleanup job with post_id substring in `note` field must remain (was the LIKE bug)")
	require.True(t, ids[decoySimilarPost.ID], "publish_post job for a different post whose ID shares a prefix must remain (was the LIKE bug)")
	require.True(t, ids[decoyNonPublishWithPostID.ID], "non-publish job that happens to include a post_id field must remain (defence-in-depth)")
}
