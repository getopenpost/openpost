package migrations

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

type legacyTranslationQueryCounter struct {
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *legacyTranslationQueryCounter) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	if counter.enabled.Load() {
		counter.count.Add(1)
	}
	return ctx
}

func (*legacyTranslationQueryCounter) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestLegacyPublicationBackfillResumesAfterCancellationAndIsIdempotent(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	allowLegacyActiveUnscopedJobsForTest(t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-backfill", Name: "Backfill"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-backfill", WorkspaceID: "workspace-backfill", Platform: "x",
		AccountID: "x-backfill", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	posts := []models.Post{
		{ID: "legacy-a", WorkspaceID: "workspace-backfill", CreatedByID: "user-1", Content: "Scheduled", Status: models.PostStatusScheduled, ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now},
		{ID: "legacy-b", WorkspaceID: "workspace-backfill", CreatedByID: "user-1", Content: "Draft B", Status: models.PostStatusDraft, CreatedAt: now.Add(time.Second)},
		{ID: "legacy-c", WorkspaceID: "workspace-backfill", CreatedByID: "user-1", Content: "Draft C", Status: models.PostStatusDraft, CreatedAt: now.Add(2 * time.Second)},
	}
	_, err = db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-backfill", PostID: "legacy-a", SocialAccountID: "account-backfill", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Job{
		ID: "legacy-job", Type: "publish_post", Payload: `{"post_id":"legacy-a"}`,
		Status: "pending", RunAt: now.Add(time.Hour), MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)

	restartLegacyBackfillStateForTest(t, db)
	done, err := runLegacyPublicationAuthoringBackfillBatch(ctx, db, 1)
	require.NoError(t, err)
	require.False(t, done)
	state, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseJobScopes, state.Phase)
	require.Equal(t, "legacy-job", state.CursorID)
	require.Equal(t, int64(1), state.ProcessedCount)

	canceled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = runLegacyPublicationAuthoringBackfillBatch(canceled, db, 1)
	require.ErrorIs(t, err, context.Canceled)
	afterCancel, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, state.Phase, afterCancel.Phase)
	require.Equal(t, state.CursorID, afterCancel.CursorID)
	require.Equal(t, state.ProcessedCount, afterCancel.ProcessedCount)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	for _, postID := range []string{"legacy-a", "legacy-b", "legacy-c"} {
		var post models.Post
		require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", postID).Scan(ctx))
		require.NotEmpty(t, post.PublicationID)
	}
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "legacy-job").Scan(ctx))
	require.Equal(t, "publish_publication", job.Type)
	require.Equal(t, "legacy-publication:legacy-a", job.ScopeID)
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	batchID, _ := payload["authorization_batch_id"].(string)
	require.NotEmpty(t, batchID)
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("batch_id = ? AND job_id = ?", batchID, job.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, receiptCount)

	state, err = loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseComplete, state.Phase)
	require.False(t, state.CompletedAt.IsZero())
	publicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, runTestMigrations(t, db))
	stablePublicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, publicationCount, stablePublicationCount)
}

func TestCompletedLegacyPublicationBackfillDoesNotReopenForUnrepairableHistory(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	before, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseComplete, before.Phase)
	_, err = db.NewInsert().Model(&models.Job{
		ID: "malformed-historical-job", Type: "publish_post", Payload: `{broken`,
		Status: "completed", RunAt: time.Now().UTC(), MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID: "orphan-historical-post", WorkspaceID: "missing-workspace", CreatedByID: "missing-user",
		Content: "orphan", Status: models.PostStatusDraft, CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	after, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseComplete, after.Phase)
	require.Equal(t, before.ProcessedCount, after.ProcessedCount)
	require.Equal(t, before.UpdatedAt, after.UpdatedAt)

	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "malformed-historical-job").Scan(ctx))
	require.Empty(t, job.ScopeID)
	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "orphan-historical-post").Scan(ctx))
	require.Empty(t, post.PublicationID)
}

func TestLegacyPublicationBackfillBoundsStartupWorkAndResumesAcrossStartups(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	jobCount := legacyPublicationBackfillBatchSize*legacyPublicationBackfillMaxBatchesPerStartup + 1
	jobs := make([]models.Job, 0, jobCount)
	for index := range jobCount {
		postID := fmt.Sprintf("post-%04d", index)
		jobs = append(jobs, models.Job{
			ID: fmt.Sprintf("job-%04d", index), Type: "publish_post",
			Payload: fmt.Sprintf(`{"post_id":%q}`, postID), Status: "completed", RunAt: time.Now().UTC(),
		})
	}
	_, err := db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)
	restartLegacyBackfillStateForTest(t, db)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	state, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseJobScopes, state.Phase)
	require.Equal(t, int64(legacyPublicationBackfillBatchSize*legacyPublicationBackfillMaxBatchesPerStartup), state.ProcessedCount)

	missingScopeCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ''").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, missingScopeCount, "one record must remain for the next bounded startup pass")

	for attempt := 0; attempt < 4 && state.Phase != legacyPublicationBackfillPhaseComplete; attempt++ {
		require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
		state, err = loadLegacyPublicationBackfillState(ctx, db)
		require.NoError(t, err)
	}
	require.Equal(t, legacyPublicationBackfillPhaseComplete, state.Phase)
	missingScopeCount, err = db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ''").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, missingScopeCount)
}

func TestLegacyPublicationBackfillRepairsPendingBlankScopeBeforeBoundedHistory(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	allowLegacyActiveUnscopedJobsForTest(t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-pending-scope", Name: "Pending scope"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-pending-scope", WorkspaceID: "workspace-pending-scope", Platform: "x",
		AccountID: "x-pending-scope", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	target := &models.Post{
		ID: "target-pending-scope", WorkspaceID: "workspace-pending-scope", CreatedByID: "user-1",
		Content: "One external write", Status: models.PostStatusScheduled,
		ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(target).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-pending-scope", PostID: target.ID,
		SocialAccountID: "account-pending-scope", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)

	historyCount := legacyPublicationBackfillBatchSize*legacyPublicationBackfillMaxBatchesPerStartup + 1
	jobs := make([]models.Job, 0, historyCount+1)
	for index := range historyCount {
		postID := fmt.Sprintf("history-post-%04d", index)
		jobs = append(jobs, models.Job{
			ID: fmt.Sprintf("history-job-%04d", index), Type: "publish_post",
			Payload: fmt.Sprintf(`{"post_id":%q}`, postID), Status: "completed", RunAt: now,
		})
	}
	jobs = append(jobs, models.Job{
		ID: "zz-target-pending-job", Type: "publish_post", Payload: `{"post_id":"target-pending-scope"}`,
		Status: "pending", RunAt: now.Add(time.Hour), MaxAttempts: 3,
	})
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)
	restartLegacyBackfillStateForTest(t, db)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	state, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseJobScopes, state.Phase)
	require.Equal(t, int64(legacyPublicationBackfillBatchSize*legacyPublicationBackfillMaxBatchesPerStartup), state.ProcessedCount)

	var targetJob models.Job
	require.NoError(t, db.NewSelect().Model(&targetJob).Where("id = ?", "zz-target-pending-job").Scan(ctx))
	require.Equal(t, "publish_publication", targetJob.Type, "active publish_post work must migrate before bounded history")
	require.Equal(t, "legacy-publication:"+target.ID, targetJob.ScopeID)
	require.Contains(t, targetJob.Payload, "authorization_batch_id")

	var pending []models.Job
	require.NoError(t, db.NewSelect().Model(&pending).
		Where("status = ? AND type IN (?)", "pending", bun.List([]string{"publish_post", "publish_publication"})).
		Scan(ctx))
	require.Len(t, pending, 1, "translation must preserve exactly one pending external write")
	require.Equal(t, targetJob.ID, pending[0].ID)
	require.Equal(t, "publish_publication", pending[0].Type)
	require.Equal(t, "legacy-publication:"+target.ID, pending[0].ScopeID)
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ? AND publication_id = ?", targetJob.ID, pending[0].ScopeID).Count(ctx)
	require.NoError(t, err)
	require.Positive(t, receiptCount, "active legacy work must be receipt-bound before resume returns")
}

func TestLegacyPublicationBackfillRepairsProtectedFailedBlankScopeBeyondBoundedHistory(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-protected-history", Name: "Protected history"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-protected-history", WorkspaceID: "workspace-protected-history", Platform: "x",
		AccountID: "x-protected-history", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID: "zz-protected-history-post", WorkspaceID: "workspace-protected-history", CreatedByID: "user-1",
		Content: "Protected history", Status: models.PostStatusFailed, CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	const historyCount = legacyPublicationBackfillBatchSize * legacyPublicationBackfillMaxBatchesPerStartup
	jobs := make([]models.Job, 0, historyCount+1)
	attempts := make([]models.ProviderWriteAttempt, 0, historyCount+1)
	now := time.Now().UTC().Truncate(time.Microsecond)
	for index := range historyCount {
		jobID := fmt.Sprintf("history-protected-scan-job-%04d", index)
		attemptID := fmt.Sprintf("history-protected-scan-attempt-%04d", index)
		jobs = append(jobs, models.Job{
			ID: jobID, Type: "maintenance", ScopeID: "already-scoped", Payload: `{}`,
			Status: "completed", RunAt: now, MaxAttempts: 1,
		})
		attempts = append(attempts, models.ProviderWriteAttempt{
			ID: attemptID, OperationID: "legacy:" + jobID + ":publish", AttemptNumber: 1,
			JobID: jobID, WorkspaceID: "workspace-protected-history", SocialAccountID: "account-protected-history",
			TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:" + attemptID,
			Status: providerwrite.StatusAccepted, SubmissionState: "accepted", RetrySafety: "never",
			CreatedAt: now, UpdatedAt: now,
		})
	}
	targetJob := models.Job{
		ID: "zz-protected-history-job", Type: "publish_post",
		Payload: `{"post_id":"zz-protected-history-post"}`, Status: "failed", RunAt: now, MaxAttempts: 3,
	}
	jobs = append(jobs, targetJob)
	attempts = append(attempts, models.ProviderWriteAttempt{
		ID: "zz-protected-history-attempt", OperationID: "legacy:zz-protected-history-job:publish", AttemptNumber: 1,
		JobID: targetJob.ID, WorkspaceID: "workspace-protected-history", SocialAccountID: "account-protected-history",
		TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:protected-history-target",
		Status: providerwrite.StatusAccepted, SubmissionState: "accepted", RetrySafety: "never",
		CreatedAt: now, UpdatedAt: now,
	})
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&attempts).Exec(ctx)
	require.NoError(t, err)
	restartLegacyBackfillStateForTest(t, db)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, db.NewSelect().Model(&targetJob).Where("id = ?", targetJob.ID).Scan(ctx))
	require.Equal(t, "zz-protected-history-post", targetJob.ScopeID,
		"protected failed history must be fenced even when the capped historical phase cannot reach it")
	mainState, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, int64(historyCount), mainState.ProcessedCount)
	var scanState legacyPublicationBackfillState
	require.NoError(t, db.NewSelect().Model(&scanState).
		Where("key = ?", legacyPublicationProtectedScopeKeyPrefix+providerwrite.StatusAccepted).
		Scan(ctx))
	require.Equal(t, legacyPublicationBackfillPhaseComplete, scanState.Phase)
	require.Equal(t, int64(historyCount+1), scanState.ProcessedCount)
	processed := scanState.ProcessedCount
	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, db.NewSelect().Model(&scanState).
		Where("key = ?", legacyPublicationProtectedScopeKeyPrefix+providerwrite.StatusAccepted).
		Scan(ctx))
	require.Equal(t, processed, scanState.ProcessedCount, "completed safety scans must stay quiet across restarts")
}

func TestLegacyPublicationBackfillRemovesNonExecutableCanonicalJob(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-no-destination", Name: "No destination"}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	publication := &models.Publication{
		ID: "publication-no-destination", WorkspaceID: "workspace-no-destination", CreatedByID: "user-1",
		Title: "Recoverable draft", SourceText: "Add a destination", SourceContent: "Add a destination",
		Status: models.PublicationStatusScheduled, ScheduledAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	post := &models.Post{
		ID: "post-no-destination", WorkspaceID: "workspace-no-destination", CreatedByID: "user-1",
		PublicationID: publication.ID, Content: "Add a destination", Status: models.PostStatusScheduled,
		ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(post).Exec(ctx)
	require.NoError(t, err)
	job := &models.Job{
		ID: "job-no-destination", Type: "publish_publication", ScopeID: publication.ID,
		Payload: fmt.Sprintf(`{"publication_id":%q}`, publication.ID), Status: "pending", RunAt: now.Add(time.Hour),
	}
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount, "a destination-free job must not consume worker retries")
	require.NoError(t, db.NewSelect().Model(post).Where("id = ?", post.ID).Scan(ctx))
	require.Equal(t, publication.ID, post.PublicationID, "the compatibility draft remains recoverable")
	require.NoError(t, db.NewSelect().Model(publication).Where("id = ?", publication.ID).Scan(ctx))
}

func TestLegacyPublicationBackfillFencesStaleProcessingWritesBeforeMigration(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	allowLegacyActiveUnscopedJobsForTest(t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-stale-write", Name: "Stale write"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-stale-write", WorkspaceID: "workspace-stale-write", Platform: "x",
		AccountID: "x-stale-write", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	posts := []models.Post{
		{ID: "post-stale-sending", WorkspaceID: "workspace-stale-write", CreatedByID: "user-1", Content: "Sending", Status: models.PostStatusScheduled, ScheduledAt: now.Add(-time.Hour), ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "post-stale-ambiguous", WorkspaceID: "workspace-stale-write", CreatedByID: "user-1", Content: "Ambiguous", Status: models.PostStatusScheduled, ScheduledAt: now.Add(-time.Hour), ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "post-stale-accepted", WorkspaceID: "workspace-stale-write", CreatedByID: "user-1", Content: "Accepted", Status: models.PostStatusScheduled, ScheduledAt: now.Add(-time.Hour), ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "post-stale-safe", WorkspaceID: "workspace-stale-write", CreatedByID: "user-1", Content: "Safe", Status: models.PostStatusPublishing, ScheduledAt: now.Add(-time.Hour), ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "post-recent-processing", WorkspaceID: "workspace-stale-write", CreatedByID: "user-1", Content: "Recent", Status: models.PostStatusScheduled, ScheduledAt: now.Add(-time.Hour), ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour)},
	}
	_, err = db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)
	destinations := []models.PostDestination{
		{ID: "destination-stale-sending", PostID: posts[0].ID, SocialAccountID: "account-stale-write", Status: "pending"},
		{ID: "destination-stale-ambiguous", PostID: posts[1].ID, SocialAccountID: "account-stale-write", Status: "pending"},
		{ID: "destination-stale-accepted", PostID: posts[2].ID, SocialAccountID: "account-stale-write", Status: "pending"},
		{ID: "destination-stale-safe", PostID: posts[3].ID, SocialAccountID: "account-stale-write", Status: "pending"},
		{ID: "destination-recent-processing", PostID: posts[4].ID, SocialAccountID: "account-stale-write", Status: "pending"},
	}
	_, err = db.NewInsert().Model(&destinations).Exec(ctx)
	require.NoError(t, err)
	lockedAt := now.Add(-legacyPublicationStaleProcessingAge - time.Minute)
	jobs := []models.Job{
		{ID: "job-stale-sending", Type: "publish_post", Payload: `{"post_id":"post-stale-sending"}`, Status: "processing", RunAt: now.Add(-time.Hour), LockedAt: lockedAt, LockedBy: "dead-worker"},
		{ID: "job-stale-ambiguous", Type: "publish_post", Payload: `{"post_id":"post-stale-ambiguous"}`, Status: "processing", RunAt: now.Add(-time.Hour), LockedAt: lockedAt, LockedBy: "dead-worker"},
		{ID: "job-stale-accepted", Type: "publish_post", Payload: `{"post_id":"post-stale-accepted"}`, Status: "processing", RunAt: now.Add(-time.Hour), LockedAt: lockedAt, LockedBy: "dead-worker"},
		{ID: "job-stale-safe", Type: "publish_post", Payload: `{"post_id":"post-stale-safe"}`, Status: "processing", RunAt: now.Add(-time.Hour), LockedAt: lockedAt, LockedBy: "dead-worker"},
		{ID: "job-recent-processing", Type: "publish_post", Payload: `{"post_id":"post-recent-processing"}`, Status: "processing", RunAt: now.Add(-time.Hour), LockedAt: now.Add(-time.Minute), LockedBy: "live-worker"},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)
	conflictingSibling := &models.Job{
		ID: "job-stale-sending-sibling", Type: "publish_post",
		Payload: `{"post_id":"post-stale-sending"}`, Status: "pending", RunAt: now.Add(-time.Hour), MaxAttempts: 3,
	}
	_, err = db.NewInsert().Model(conflictingSibling).Exec(ctx)
	require.NoError(t, err)
	attempts := []models.ProviderWriteAttempt{
		{ID: "attempt-stale-sending", OperationID: "legacy:job-stale-sending:x", AttemptNumber: 1, JobID: jobs[0].ID, WorkspaceID: "workspace-stale-write", SocialAccountID: "account-stale-write", TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:sending", Status: "sending", SubmissionState: "unknown", RetrySafety: "never", CreatedAt: lockedAt, UpdatedAt: lockedAt},
		{ID: "attempt-stale-ambiguous", OperationID: "legacy:job-stale-ambiguous:x", AttemptNumber: 1, JobID: jobs[1].ID, WorkspaceID: "workspace-stale-write", SocialAccountID: "account-stale-write", TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:ambiguous", Status: "ambiguous", SubmissionState: "unknown", RetrySafety: "never", CreatedAt: lockedAt, UpdatedAt: lockedAt},
		{ID: "attempt-stale-accepted", OperationID: "legacy:job-stale-accepted:x", AttemptNumber: 1, JobID: jobs[2].ID, WorkspaceID: "workspace-stale-write", SocialAccountID: "account-stale-write", TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:accepted", Status: "accepted", SubmissionState: "accepted", RetrySafety: "never", CreatedAt: lockedAt, UpdatedAt: lockedAt},
	}
	_, err = db.NewInsert().Model(&attempts).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, db.NewSelect().Model(conflictingSibling).Where("id = ?", conflictingSibling.ID).Scan(ctx))
	require.Equal(t, posts[0].ID, conflictingSibling.ScopeID)
	require.Equal(t, "failed", conflictingSibling.Status, "an unprotected sibling cannot remain executable beside protected work")
	require.Contains(t, conflictingSibling.LastError, "did not start this duplicate job")
	for index, expectedStatus := range []string{"ambiguous", "ambiguous", "accepted"} {
		require.NoError(t, db.NewSelect().Model(&attempts[index]).Where("id = ?", attempts[index].ID).Scan(ctx))
		require.Equal(t, expectedStatus, attempts[index].Status)
		require.NoError(t, db.NewSelect().Model(&jobs[index]).Where("id = ?", jobs[index].ID).Scan(ctx))
		require.Equal(t, "publish_post", jobs[index].Type, "a protected legacy operation identity must never be canonicalized")
		require.Equal(t, "pending", jobs[index].Status)
		require.NoError(t, db.NewSelect().Model(&posts[index]).Where("id = ?", posts[index].ID).Scan(ctx))
		require.Empty(t, posts[index].PublicationID)
		err = MigrateLegacyPublicationAuthoringForActor(ctx, db, posts[index].ID, publicationauth.Actor{
			Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-protected-write",
		})
		require.ErrorIs(t, err, errLegacyPublicationProviderRecovery)
		require.NoError(t, db.NewSelect().Model(&jobs[index]).Where("id = ?", jobs[index].ID).Scan(ctx))
		require.Equal(t, "publish_post", jobs[index].Type, "request translation must preserve the protected operation identity")
		if index == 0 {
			err = db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
				return SyncTextPostAuthoringTx(txCtx, tx, posts[index].ID)
			})
			require.ErrorIs(t, err, errLegacyPublicationProviderRecovery)
		}
	}

	require.NoError(t, db.NewSelect().Model(&jobs[3]).Where("id = ?", jobs[3].ID).Scan(ctx))
	require.Equal(t, "publish_publication", jobs[3].Type, "provably unsent stale work may migrate")
	require.Equal(t, "pending", jobs[3].Status)
	require.Contains(t, jobs[3].Payload, "authorization_batch_id")
	require.NoError(t, db.NewSelect().Model(&posts[3]).Where("id = ?", posts[3].ID).Scan(ctx))
	require.NotEmpty(t, posts[3].PublicationID)
	require.Equal(t, models.PostStatusScheduled, posts[3].Status, "a pre-attempt publishing crash must recover to executable scheduled state")
	var safePublication models.Publication
	require.NoError(t, db.NewSelect().Model(&safePublication).Where("id = ?", posts[3].PublicationID).Scan(ctx))
	require.Equal(t, models.PublicationStatusScheduled, safePublication.Status)

	require.NoError(t, db.NewSelect().Model(&jobs[4]).Where("id = ?", jobs[4].ID).Scan(ctx))
	require.Equal(t, "publish_post", jobs[4].Type)
	require.Equal(t, "processing", jobs[4].Status)
	require.Equal(t, posts[4].ID, jobs[4].ScopeID, "recent active scope must be repaired before requests start")
	err = MigrateLegacyPublicationAuthoringForActor(ctx, db, posts[4].ID, publicationauth.Actor{
		Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-recent-processing",
	})
	require.ErrorIs(t, err, errLegacyPublicationProviderRecovery)
	require.NoError(t, db.NewSelect().Model(&posts[4]).Where("id = ?", posts[4].ID).Scan(ctx))
	require.Empty(t, posts[4].PublicationID)
}

func TestLegacyPublicationBackfillQuarantinesProtectedCanonicalJobWithoutBinding(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-canonical-quarantine", Name: "Canonical quarantine"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-canonical-quarantine", WorkspaceID: "workspace-canonical-quarantine", Platform: "x",
		AccountID: "x-canonical-quarantine", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	publication := &models.Publication{
		ID: "publication-canonical-quarantine", WorkspaceID: "workspace-canonical-quarantine", CreatedByID: "user-1",
		Title: "Quarantine", SourceText: "Quarantine", SourceContent: "Quarantine",
		Status: models.PublicationStatusPublishing, ScheduledAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, func() error { _, err := db.NewInsert().Model(publication).Exec(ctx); return err }())
	post := &models.Post{
		ID: "post-canonical-quarantine", PublicationID: publication.ID, WorkspaceID: publication.WorkspaceID,
		CreatedByID: "user-1", Content: "Quarantine", Status: models.PostStatusPublishing,
		ScheduledAt: publication.ScheduledAt, ActualRunAt: publication.ScheduledAt, CreatedAt: now,
	}
	require.NoError(t, func() error { _, err := db.NewInsert().Model(post).Exec(ctx); return err }())
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&models.Rendition{
			ID: "rendition-canonical-quarantine", PublicationID: publication.ID, SocialAccountID: "account-canonical-quarantine",
			Platform: "x", Profile: models.ContentProfileShortText, Body: "Quarantine",
			Status: models.RenditionStatusPublishing, CreatedAt: now, UpdatedAt: now,
		}).Exec(ctx)
		return err
	}())
	_, err = db.NewInsert().Model(&models.PublicationSegment{
		ID: "segment-canonical-quarantine", PublicationID: publication.ID, Position: 0, Body: "Quarantine",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.RenditionSegment{
		ID: "rendition-segment-canonical-quarantine", RenditionID: "rendition-canonical-quarantine",
		PublicationSegmentID: "segment-canonical-quarantine", Position: 0, Body: "Quarantine",
		Status: models.RenditionStatusPublishing, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	lockedAt := now.Add(-legacyPublicationStaleProcessingAge - time.Minute)
	job := &models.Job{
		ID: "job-canonical-quarantine", Type: "publish_publication", ScopeID: publication.ID,
		Payload: `{"publication_id":"publication-canonical-quarantine"}`, Status: "processing",
		RunAt: publication.ScheduledAt, LockedAt: lockedAt, LockedBy: "dead-worker", MaxAttempts: 3,
	}
	require.NoError(t, func() error { _, err := db.NewInsert().Model(job).Exec(ctx); return err }())
	attempt := &models.ProviderWriteAttempt{
		ID: "attempt-canonical-quarantine", OperationID: "legacy:job-canonical-quarantine:rendition-canonical-quarantine:publish", AttemptNumber: 1,
		JobID: job.ID, WorkspaceID: publication.WorkspaceID,
		SocialAccountID: "account-canonical-quarantine", TargetKey: "x", Provider: "x", Operation: "publish",
		PayloadFingerprint: "sha256:canonical-quarantine", Status: "sending", SubmissionState: "unknown",
		RetrySafety: "never", CreatedAt: lockedAt, UpdatedAt: lockedAt,
	}
	require.NoError(t, func() error { _, err := db.NewInsert().Model(attempt).Exec(ctx); return err }())

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, "job-canonical-quarantine", job.ID)
	require.Equal(t, "publish_publication", job.Type)
	require.Equal(t, "failed", job.Status)
	require.Contains(t, job.LastError, "did not retry")
	require.NotContains(t, job.Payload, "authorization_batch_id")
	require.NoError(t, db.NewSelect().Model(attempt).Where("id = ?", attempt.ID).Scan(ctx))
	require.Equal(t, "ambiguous", attempt.Status)
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Where("job_id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, receiptCount)
	require.NoError(t, db.NewSelect().Model(publication).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, models.PublicationStatusFailed, publication.Status)
	require.NoError(t, db.NewSelect().Model(post).Where("id = ?", post.ID).Scan(ctx))
	require.Equal(t, models.PostStatusFailed, post.Status)
	var quarantinedRendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&quarantinedRendition).Where("id = ?", "rendition-canonical-quarantine").Scan(ctx))
	require.Equal(t, models.RenditionStatusFailed, quarantinedRendition.Status)
	var quarantinedSegment models.RenditionSegment
	require.NoError(t, db.NewSelect().Model(&quarantinedSegment).Where("id = ?", "rendition-segment-canonical-quarantine").Scan(ctx))
	require.Equal(t, models.RenditionStatusFailed, quarantinedSegment.Status)
	require.False(t, quarantinedSegment.ErrorRetryable)

	pendingJob := &models.Job{
		ID: "job-canonical-quarantine-pending", Type: "publish_publication", ScopeID: publication.ID,
		Payload: `{"publication_id":"publication-canonical-quarantine"}`, Status: "pending",
		RunAt: publication.ScheduledAt, MaxAttempts: 3,
	}
	_, err = db.NewInsert().Model(pendingJob).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderWriteAttempt{
		ID: "attempt-canonical-quarantine-pending", OperationID: "legacy:job-canonical-quarantine-pending:publish",
		AttemptNumber: 1, JobID: pendingJob.ID, WorkspaceID: publication.WorkspaceID,
		SocialAccountID: quarantinedRendition.SocialAccountID, TargetKey: "x", Provider: "x", Operation: "publish",
		PayloadFingerprint: "sha256:canonical-quarantine-pending", Status: "sending", SubmissionState: "unknown",
		RetrySafety: "never", CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, db.NewSelect().Model(pendingJob).Where("id = ?", pendingJob.ID).Scan(ctx))
	require.Equal(t, "failed", pendingJob.Status, "already-pending protected work must quarantine without changing identity")
	require.NotContains(t, pendingJob.Payload, "authorization_batch_id")

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, "failed", job.Status)
	err = MigrateLegacyPublicationAuthoringForActor(ctx, db, post.ID, publicationauth.Actor{
		Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-canonical-quarantine",
	})
	require.ErrorIs(t, err, errLegacyPublicationProviderRecovery)
}

func TestLegacyPublicationRequestRechecksWorkerClaimInsideTransaction(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-claim-race", Name: "Claim race"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-claim-race", WorkspaceID: "workspace-claim-race", Platform: "x",
		AccountID: "x-claim-race", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	post := &models.Post{
		ID: "post-claim-race", WorkspaceID: "workspace-claim-race", CreatedByID: "user-1",
		Content: "Do not race the worker", Status: models.PostStatusScheduled,
		ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(post).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-claim-race", PostID: post.ID, SocialAccountID: "account-claim-race", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	job := &models.Job{
		ID: "job-claim-race", Type: "publish_post", ScopeID: post.ID,
		Payload: `{"post_id":"post-claim-race"}`, Status: "pending", RunAt: now.Add(time.Hour),
	}
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	protected, err := legacyPublicationAggregateHasProtectedWrite(ctx, db, post.ID)
	require.NoError(t, err)
	require.False(t, protected, "the request's initial check observes unclaimed work")
	_, err = db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", "processing").Set("locked_at = ?", now).Set("locked_by = ?", "worker-race").
		Where("id = ?", job.ID).Exec(ctx)
	require.NoError(t, err)

	err = migrateLegacyPost(ctx, db, *post, publicationauth.Actor{
		Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-claim-race",
	})
	require.ErrorIs(t, err, errLegacyPublicationProviderRecovery)
	require.NoError(t, db.NewSelect().Model(post).Where("id = ?", post.ID).Scan(ctx))
	require.Empty(t, post.PublicationID, "the transactional recheck must roll back canonicalization")
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, "publish_post", job.Type)
	require.Equal(t, "processing", job.Status)
	publicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).
		Where("id = ?", "legacy-publication:"+post.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, publicationCount)
}

func TestLegacyPublicationBackfillAuthorizesPendingCanonicalJobBeforeBoundedHistory(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	allowLegacyActiveUnscopedJobsForTest(t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-pending-auth", Name: "Pending auth"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-pending-auth", WorkspaceID: "workspace-pending-auth", Platform: "x",
		AccountID: "x-pending-auth", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	publication := &models.Publication{
		ID: "publication-pending-auth", WorkspaceID: "workspace-pending-auth", CreatedByID: "user-1",
		Title: "Pending authorization", SourceText: "Authorize before worker",
		SourceContent: "Authorize before worker", Status: models.PublicationStatusScheduled,
		ScheduledAt: now.Add(-time.Minute), CreatedAt: now.Add(-time.Hour), UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-pending-auth", PublicationID: publication.ID, SocialAccountID: "account-pending-auth",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Authorize before worker",
		Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)

	historyCount := legacyPublicationBackfillBatchSize*legacyPublicationBackfillMaxBatchesPerStartup + 1
	jobs := make([]models.Job, 0, historyCount+1)
	for index := range historyCount {
		postID := fmt.Sprintf("auth-history-post-%04d", index)
		jobs = append(jobs, models.Job{
			ID: fmt.Sprintf("auth-history-job-%04d", index), Type: "publish_post",
			Payload: fmt.Sprintf(`{"post_id":%q}`, postID), Status: "completed", RunAt: now,
		})
	}
	dueJob := models.Job{
		ID: "zz-due-canonical-job", Type: "publish_publication", ScopeID: publication.ID,
		Payload: fmt.Sprintf(`{"publication_id":%q}`, publication.ID),
		Status:  "pending", RunAt: now.Add(-time.Minute), MaxAttempts: 3,
	}
	jobs = append(jobs, dueJob)
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)
	restartLegacyBackfillStateForTest(t, db)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	state, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseJobScopes, state.Phase)
	require.Equal(t, int64(legacyPublicationBackfillBatchSize*legacyPublicationBackfillMaxBatchesPerStartup), state.ProcessedCount)

	require.NoError(t, db.NewSelect().Model(&dueJob).Where("id = ?", dueJob.ID).Scan(ctx))
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(dueJob.Payload), &payload))
	batchID, _ := payload["authorization_batch_id"].(string)
	require.NotEmpty(t, batchID, "active canonical work must be authorized before bounded history yields")
	require.Equal(t, dueJob.RunAt.UTC().Format(time.RFC3339Nano), payload["authorization_scheduled_at"])
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("batch_id = ? AND job_id = ? AND publication_id = ?", batchID, dueJob.ID, publication.ID).
		Count(ctx)
	require.NoError(t, err)
	require.Positive(t, receiptCount)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	stableReceiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", dueJob.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, receiptCount, stableReceiptCount, "startup authorization safety must be idempotent")
}

func TestLegacyPublicationAuthorizationBackfillRollsBackAndResumesAtomically(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	now := time.Now().UTC().Truncate(time.Microsecond)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-auth", Name: "Authorization"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-auth", WorkspaceID: "workspace-auth", Platform: "x", AccountID: "x-auth",
		AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-auth", WorkspaceID: "workspace-auth", CreatedByID: "user-1", Title: "Authorization",
		SourceText: "Atomic authorization", SourceContent: "Atomic authorization", Status: models.PublicationStatusScheduled,
		ScheduledAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-auth", PublicationID: "publication-auth", SocialAccountID: "account-auth",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Atomic authorization",
		Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	job := &models.Job{
		ID: "job-auth", Type: "publish_publication", ScopeID: "publication-auth",
		Payload: `{"publication_id":"publication-auth"}`, Status: "pending", RunAt: now.Add(time.Hour),
	}
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("phase = ?", legacyPublicationBackfillPhaseAuth).
		Set("cursor_id = ''").
		Set("completed_at = NULL").
		Where("key = ?", legacyPublicationBackfillKey).
		Exec(ctx)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `CREATE TRIGGER fail_legacy_authorization_bind
		BEFORE UPDATE OF payload ON jobs
		WHEN OLD.id = 'job-auth' AND instr(NEW.payload, 'authorization_batch_id') > 0
		BEGIN
			SELECT RAISE(ABORT, 'injected authorization bind failure');
		END`)
	require.NoError(t, err)
	done, err := runLegacyPublicationAuthoringBackfillBatch(ctx, db, 1)
	require.ErrorContains(t, err, "injected authorization bind failure")
	require.False(t, done)

	state, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseAuth, state.Phase)
	require.Empty(t, state.CursorID)
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, receiptCount, "the failed payload bind must roll back its receipt")
	eventCount, err := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", "publication-auth").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, eventCount, "the failed payload bind must roll back its lifecycle event")
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.NotContains(t, job.Payload, "authorization_batch_id")

	_, err = db.ExecContext(ctx, "DROP TRIGGER fail_legacy_authorization_bind")
	require.NoError(t, err)
	done, err = runLegacyPublicationAuthoringBackfillBatch(ctx, db, 1)
	require.NoError(t, err)
	require.False(t, done)
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.Contains(t, job.Payload, "authorization_batch_id")
	receiptCount, err = db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, receiptCount)

	linkedPost := &models.Post{
		ID: "post-auth-linked", WorkspaceID: "workspace-auth", CreatedByID: "user-1",
		PublicationID: "publication-auth", Content: "Linked authorization",
		Status: models.PostStatusScheduled, ScheduledAt: now.Add(2 * time.Hour), ActualRunAt: now.Add(2 * time.Hour),
	}
	_, err = db.NewInsert().Model(linkedPost).Exec(ctx)
	require.NoError(t, err)
	linkedJob := &models.Job{
		ID: "job-auth-linked", Type: "publish_publication", ScopeID: "publication-auth",
		Payload: `{"publication_id":"publication-auth"}`, Status: "pending", RunAt: now.Add(2 * time.Hour),
	}
	_, err = db.NewInsert().Model(linkedJob).Exec(ctx)
	require.NoError(t, err)
	eventsBefore, err := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", "publication-auth").Count(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TRIGGER fail_linked_legacy_authorization_bind
		BEFORE UPDATE OF payload ON jobs
		WHEN OLD.id = 'job-auth-linked' AND instr(NEW.payload, 'authorization_batch_id') > 0
		BEGIN
			SELECT RAISE(ABORT, 'injected linked authorization bind failure');
		END`)
	require.NoError(t, err)
	err = MigrateLegacyPublicationAuthoringForActor(ctx, db, linkedPost.ID, publicationauth.Actor{
		Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-linked-auth",
	})
	require.ErrorContains(t, err, "injected linked authorization bind failure")
	linkedReceiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", linkedJob.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, linkedReceiptCount, "already-linked authorization must roll back its receipt")
	linkedEventsAfter, err := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", "publication-auth").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, eventsBefore, linkedEventsAfter, "already-linked authorization must roll back its event")
	require.NoError(t, db.NewSelect().Model(linkedJob).Where("id = ?", linkedJob.ID).Scan(ctx))
	require.NotContains(t, linkedJob.Payload, "authorization_batch_id")
	_, err = db.ExecContext(ctx, "DROP TRIGGER fail_linked_legacy_authorization_bind")
	require.NoError(t, err)
}

func TestScopedLegacyPublicationTranslationQueryCountIgnoresHistoricalRows(t *testing.T) {
	withoutHistory := scopedLegacyTranslationQueryCount(t, 0)
	withHistory := scopedLegacyTranslationQueryCount(t, 200)
	require.Equal(t, withoutHistory, withHistory)
}

func scopedLegacyTranslationQueryCount(t *testing.T, historicalRows int) int64 {
	t.Helper()
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-query-count", Name: "Query count"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-query-count", WorkspaceID: "workspace-query-count", Platform: "x",
		AccountID: "x-query-count", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	target := &models.Post{
		ID: "target-post", WorkspaceID: "workspace-query-count", CreatedByID: "user-1",
		Content: "Target", Status: models.PostStatusScheduled, ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(target).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "target-destination", PostID: target.ID, SocialAccountID: "account-query-count", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Job{
		ID: "target-job", Type: "publish_post", ScopeID: target.ID, Payload: `{"post_id":"target-post"}`,
		Status: "pending", RunAt: now.Add(time.Hour), MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)
	if historicalRows > 0 {
		history := make([]models.Post, 0, historicalRows)
		for index := range historicalRows {
			history = append(history, models.Post{
				ID: fmt.Sprintf("unrelated-%04d", index), WorkspaceID: "workspace-query-count",
				CreatedByID: "user-1", Content: "Unrelated history", Status: models.PostStatusDraft,
				CreatedAt: now.Add(-time.Duration(index+1) * time.Minute),
			})
		}
		_, err = db.NewInsert().Model(&history).Exec(ctx)
		require.NoError(t, err)
	}

	counter := &legacyTranslationQueryCounter{}
	db.AddQueryHook(counter)
	counter.enabled.Store(true)
	err = MigrateLegacyPublicationAuthoringForActor(ctx, db, target.ID, publicationauth.Actor{
		Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-query-count",
	})
	counter.enabled.Store(false)
	require.NoError(t, err)
	var migrated models.Post
	require.NoError(t, db.NewSelect().Model(&migrated).Where("id = ?", target.ID).Scan(ctx))
	require.Equal(t, "legacy-publication:"+target.ID, migrated.PublicationID)
	if historicalRows > 0 {
		unlinked, countErr := db.NewSelect().Model((*models.Post)(nil)).
			Where("id LIKE ? AND COALESCE(publication_id, '') = ''", "unrelated-%").Count(ctx)
		require.NoError(t, countErr)
		require.Equal(t, historicalRows, unlinked)
	}
	return counter.count.Load()
}

func createLegacyPublicationTestTables(t *testing.T, db *bun.DB) {
	t.Helper()
	for _, model := range []any{
		(*models.PostDestination)(nil), (*models.PostMedia)(nil), (*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
}

func restartLegacyBackfillStateForTest(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("phase = ?", legacyPublicationBackfillPhaseJobScopes).
		Set("cursor_id = ''").
		Set("processed_count = 0").
		Set("completed_at = NULL").
		Where("key = ? OR key LIKE ?", legacyPublicationBackfillKey, legacyPublicationProtectedScopeKeyPrefix+"%").
		Exec(t.Context())
	require.NoError(t, err)
}

func TestLegacyPublicationBackfillMigrationSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	exerciseLegacyPublicationBackfillMigration(t, db)
}

func TestLegacyPublicationBackfillMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	adminSQLDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(t.Context()))
	schema := fmt.Sprintf("legacy_publication_backfill_083_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	scopedSQLDB := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	scopedSQLDB.SetMaxOpenConns(4)
	db := bun.NewDB(scopedSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	exerciseLegacyPublicationBackfillMigration(t, db)
}

func exerciseLegacyPublicationBackfillMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	for _, model := range []any{
		(*SchemaMigration)(nil),
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.ThreadDraft)(nil),
		(*models.Job)(nil),
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAuthorization)(nil),
		(*models.ProviderWriteAttempt)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	raw, err := migrationFiles.ReadFile("083_legacy_publication_authoring_backfill.sql")
	require.NoError(t, err)
	item := migration{
		version: 83,
		name:    "083_legacy_publication_authoring_backfill.sql",
		sql:     normalizeMigrationSQL(db.Dialect().Name(), string(raw)),
	}
	require.NoError(t, runMigration(ctx, db, item))
	require.NoError(t, ensureLegacyPublicationAuthoringBackfillSchema(ctx, db))
	require.NoError(t, ensureLegacyPublicationAuthoringBackfillSchema(ctx, db))
	assertLegacySafeJobPayloadReader(t, db)
	assertLegacyPublicationBackfillIndexes(t, db)

	now := time.Now().UTC().Truncate(time.Microsecond)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-migration", Name: "Migration"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID: "user-migration", Email: "migration@example.com", PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-migration", WorkspaceID: "workspace-migration", Platform: "x",
		AccountID: "x-migration", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	posts := []models.Post{
		{
			ID: "post-scheduled", WorkspaceID: "workspace-migration", CreatedByID: "user-migration",
			Content: "Scheduled history", Status: models.PostStatusScheduled,
			ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now,
		},
		{
			ID: "post-published", WorkspaceID: "workspace-migration", CreatedByID: "user-migration",
			Content: "Published history", Status: models.PostStatusPublished, CreatedAt: now.Add(-time.Hour),
		},
		{
			ID: "post-failed", WorkspaceID: "workspace-migration", CreatedByID: "user-migration",
			Content: "Failed history", Status: models.PostStatusFailed, CreatedAt: now.Add(-2 * time.Hour),
		},
	}
	_, err = db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-migration", PostID: "post-scheduled", SocialAccountID: "account-migration", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	job := models.Job{
		ID: "job-post", Type: "publish_post", Payload: `{"post_id":"post-scheduled"}`,
		Status: "pending", RunAt: now.Add(time.Hour), MaxAttempts: 3,
	}
	_, err = db.NewInsert().Model(&job).Exec(ctx)
	require.NoError(t, err)

	done, err := runLegacyPublicationAuthoringBackfillBatch(ctx, db, 1)
	require.NoError(t, err)
	require.False(t, done)
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, "post-scheduled", job.ScopeID)

	stateBeforeCancel, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = runLegacyPublicationAuthoringBackfillBatch(canceled, db, 1)
	require.ErrorIs(t, err, context.Canceled)
	stateAfterCancel, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, stateBeforeCancel.Phase, stateAfterCancel.Phase)
	require.Equal(t, stateBeforeCancel.CursorID, stateAfterCancel.CursorID)
	require.Equal(t, stateBeforeCancel.ProcessedCount, stateAfterCancel.ProcessedCount)

	require.NoError(t, drainLegacyPublicationAuthoringBackfill(ctx, db))
	var scheduled models.Post
	require.NoError(t, db.NewSelect().Model(&scheduled).Where("id = ?", "post-scheduled").Scan(ctx))
	require.Equal(t, "legacy-publication:post-scheduled", scheduled.PublicationID)
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", scheduled.PublicationID).Scan(ctx))
	require.Equal(t, models.PublicationStatusScheduled, publication.Status)
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, "publish_publication", job.Type)
	require.Equal(t, publication.ID, job.ScopeID)
	require.Contains(t, job.Payload, "authorization_batch_id")
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ? AND publication_id = ?", job.ID, publication.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, receiptCount)

	for _, postID := range []string{"post-published", "post-failed"} {
		var historical models.Post
		require.NoError(t, db.NewSelect().Model(&historical).Where("id = ?", postID).Scan(ctx))
		require.Empty(t, historical.PublicationID, "completed compatibility history remains readable from posts")
	}
	publicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.NoError(t, drainLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	stablePublicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, publicationCount, stablePublicationCount)
	stableReceiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, stableReceiptCount)
	if db.Dialect().Name() == dialect.PG {
		assertConcurrentLegacyPublicationAuthorizationIsIdempotent(t, db, now)
	}
	assertLegacyActivePublicationScopeBinding(t, db, now)

	assertLegacyPublicationAuthoringIndexPlans(t, db)
	exists, err := migrationTableExists(ctx, db, "legacy_publication_authoring_backfill_state")
	require.NoError(t, err)
	require.True(t, exists)
}

func assertLegacySafeJobPayloadReader(t *testing.T, db *bun.DB) {
	t.Helper()
	testCases := []struct {
		name     string
		payload  string
		expected string
	}{
		{name: "top level", payload: `{"post_id":"post-1"}`, expected: "post-1"},
		{name: "malformed after valid id", payload: `{"post_id":"post-1"} broken`},
		{name: "nested id", payload: `{"nested":{"post_id":"post-1"}}`},
	}
	for _, testCase := range testCases {
		t.Run("safe legacy payload "+testCase.name, func(t *testing.T) {
			var actual sql.NullString
			var err error
			switch db.Dialect().Name() {
			case dialect.SQLite:
				err = db.NewRaw(
					`SELECT CASE WHEN json_valid(?) THEN json_extract(?, '$.post_id') ELSE NULL END`,
					testCase.payload,
					testCase.payload,
				).Scan(t.Context(), &actual)
			case dialect.PG:
				err = db.NewRaw(`SELECT openpost_safe_json_text(?, 'post_id')`, testCase.payload).
					Scan(t.Context(), &actual)
			default:
				t.Fatalf("unsupported database dialect %s", db.Dialect().Name())
			}
			require.NoError(t, err)
			if testCase.expected == "" {
				require.False(t, actual.Valid)
			} else {
				require.True(t, actual.Valid)
				require.Equal(t, testCase.expected, actual.String)
			}
		})
	}
}

func assertLegacyActivePublicationScopeBinding(t *testing.T, db *bun.DB, now time.Time) {
	t.Helper()
	ctx := t.Context()
	jobs := []models.Job{
		{
			ID: "job-old-writer-post", Type: "publish_post", Payload: `{"post_id":"post-published"}`,
			Status: "pending", RunAt: now.Add(3 * time.Hour),
		},
		{
			ID: "job-old-writer-publication", Type: "publish_publication",
			Payload: `{"publication_id":"legacy-publication:post-scheduled"}`,
			Status:  "pending", RunAt: now.Add(3 * time.Hour),
		},
		{
			ID: "job-old-writer-update", Type: "publish_post", Payload: `{"post_id":"post-failed"}`,
			Status: "completed", RunAt: now.Add(3 * time.Hour),
		},
	}
	for index := range jobs {
		_, err := db.NewInsert().Model(&jobs[index]).Exec(ctx)
		require.NoError(t, err)
	}
	_, err := db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", "pending").
		Where("id = ?", jobs[2].ID).
		Exec(ctx)
	require.NoError(t, err)

	expectedScopes := map[string]string{
		jobs[0].ID: "post-published",
		jobs[1].ID: "legacy-publication:post-scheduled",
		jobs[2].ID: "post-failed",
	}
	for jobID, expectedScope := range expectedScopes {
		var scopeID string
		require.NoError(t, db.NewSelect().Model((*models.Job)(nil)).Column("scope_id").Where("id = ?", jobID).Scan(ctx, &scopeID))
		require.Equal(t, expectedScope, scopeID, "post-083 old-writer work must become visible in the inserting statement")
	}

	for _, malformed := range []models.Job{
		{ID: "job-old-writer-malformed", Type: "publish_post", Payload: `{`, Status: "pending", RunAt: now},
		{ID: "job-old-writer-missing-scope", Type: "publish_publication", Payload: `{}`, Status: "pending", RunAt: now},
	} {
		_, err := db.NewInsert().Model(&malformed).Exec(ctx)
		require.Error(t, err, "malformed active old-writer jobs must fail closed")
	}
	_, err = db.NewDelete().Model((*models.Job)(nil)).Where("id IN (?)", bun.List([]string{jobs[0].ID, jobs[1].ID, jobs[2].ID})).Exec(ctx)
	require.NoError(t, err)
}

func assertConcurrentLegacyPublicationAuthorizationIsIdempotent(t *testing.T, db *bun.DB, now time.Time) {
	t.Helper()
	ctx := t.Context()
	publication := &models.Publication{
		ID: "publication-concurrent-authorization", WorkspaceID: "workspace-migration", CreatedByID: "user-migration",
		Title: "Concurrent", SourceText: "Concurrent", SourceContent: "Concurrent",
		Status: models.PublicationStatusScheduled, ScheduledAt: now.Add(2 * time.Hour), CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-concurrent-authorization", PublicationID: publication.ID, SocialAccountID: "account-migration",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Concurrent",
		Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	job := &models.Job{
		ID: "job-concurrent-authorization", Type: "publish_publication", ScopeID: publication.ID,
		Payload: `{"publication_id":"publication-concurrent-authorization"}`, Status: "pending",
		RunAt: publication.ScheduledAt, MaxAttempts: 3,
	}
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	start := make(chan struct{})
	errorsByCaller := make(chan error, 2)
	var callers sync.WaitGroup
	for range 2 {
		callers.Add(1)
		go func() {
			defer callers.Done()
			<-start
			errorsByCaller <- authorizePendingLegacyPublicationJob(ctx, db, job.ID)
		}()
	}
	close(start)
	callers.Wait()
	close(errorsByCaller)
	for callerErr := range errorsByCaller {
		require.NoError(t, callerErr)
	}

	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Where("job_id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, receiptCount, "concurrent starters must share one immutable authorization receipt")
	eventCount, err := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", publication.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, eventCount, "concurrent starters must not orphan an audit event")
}

func allowLegacyActiveUnscopedJobsForTest(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	switch db.Dialect().Name() {
	case dialect.SQLite:
		_, err := db.ExecContext(ctx, "DROP TRIGGER IF EXISTS jobs_active_publication_scope_insert")
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, "DROP TRIGGER IF EXISTS jobs_active_publication_scope_update")
		require.NoError(t, err)
	case dialect.PG:
		_, err := db.ExecContext(ctx, "DROP TRIGGER IF EXISTS jobs_active_publication_scope_bind ON jobs")
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, "ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_active_publication_scope_check")
		require.NoError(t, err)
	}
}

func assertLegacyPublicationBackfillIndexes(t *testing.T, db *bun.DB) {
	t.Helper()
	indexNames := []string{
		"jobs_publication_pending_idx",
		"jobs_publication_scope_idx",
		"post_destinations_legacy_authoring_idx",
		"post_variants_legacy_authoring_idx",
		"posts_legacy_thread_parent_idx",
		"provider_write_attempts_legacy_scope_scan_idx",
		"provider_write_attempts_publication_target_idx",
	}
	var count int
	switch db.Dialect().Name() {
	case dialect.SQLite:
		require.NoError(t, db.NewSelect().
			ColumnExpr("COUNT(*)").
			TableExpr("sqlite_master").
			Where("type = 'index' AND name IN (?)", bun.List(indexNames)).
			Scan(t.Context(), &count))
	case dialect.PG:
		require.NoError(t, db.NewSelect().
			ColumnExpr("COUNT(*)").
			TableExpr("pg_indexes").
			Where("schemaname = current_schema() AND indexname IN (?)", bun.List(indexNames)).
			Scan(t.Context(), &count))
	default:
		t.Fatalf("unsupported database dialect %s", db.Dialect().Name())
	}
	require.Equal(t, len(indexNames), count)
}

func assertLegacyPublicationAuthoringIndexPlans(t *testing.T, db *bun.DB) {
	t.Helper()
	queries := map[string]string{
		"jobs_publication_pending_idx": `SELECT id FROM jobs
			WHERE type = 'publish_publication' AND status = 'pending' AND id > '' ORDER BY id ASC LIMIT 64`,
		"jobs_publication_scope_idx": `SELECT id FROM jobs
			WHERE type IN ('publish_post', 'publish_publication')
			AND status IN ('pending', 'processing') AND scope_id = ''
			ORDER BY type ASC, scope_id ASC, status ASC, run_at ASC, id ASC LIMIT 64`,
		"provider_write_attempts_legacy_scope_scan_idx": `SELECT protected_attempt.id, protected_attempt.job_id
			FROM provider_write_attempts AS protected_attempt
			WHERE protected_attempt.status = 'ambiguous' AND protected_attempt.id > ''
			ORDER BY protected_attempt.id ASC LIMIT 64`,
		"provider_write_attempts_publication_target_idx": `SELECT id FROM provider_write_attempts
			WHERE publication_id = 'legacy-publication:post-scheduled'
			AND rendition_id = 'legacy-rendition:post-scheduled:account-migration'
			AND status = 'accepted' AND operation = 'publish'`,
		"posts_legacy_thread_parent_idx": `SELECT id FROM posts
			WHERE workspace_id = 'workspace-migration' AND parent_post_id = 'post-scheduled' LIMIT 2`,
		"post_destinations_legacy_authoring_idx": `SELECT id FROM post_destinations
			WHERE post_id = 'post-scheduled'`,
		"post_variants_legacy_authoring_idx": `SELECT id FROM post_variants
			WHERE post_id = 'post-scheduled' AND social_account_id = 'account-migration'`,
	}
	if db.Dialect().Name() == dialect.PG {
		_, err := db.ExecContext(t.Context(), "SET enable_seqscan = off")
		require.NoError(t, err)
	}
	for indexName, query := range queries {
		plan := ""
		switch db.Dialect().Name() {
		case dialect.SQLite:
			plan = explainSQLiteQueryPlan(t, db, query)
		case dialect.PG:
			plan = explainPostgresQueryPlan(t, db, query)
		default:
			t.Fatalf("unsupported database dialect %s", db.Dialect().Name())
		}
		require.Contains(t, plan, indexName, "%s must avoid global compatibility-table scans", indexName)
	}
	windowQueries := map[string]string{
		"jobs":  `SELECT id FROM jobs WHERE id > '' ORDER BY id ASC LIMIT 64`,
		"posts": `SELECT id FROM posts WHERE id > '' ORDER BY id ASC LIMIT 64`,
	}
	for table, query := range windowQueries {
		plan := ""
		switch db.Dialect().Name() {
		case dialect.SQLite:
			plan = explainSQLiteQueryPlan(t, db, query)
			require.Contains(t, plan, "sqlite_autoindex_"+table, "%s historical windows must use primary-key keyset order", table)
			require.NotContains(t, strings.ToUpper(plan), "TEMP B-TREE", "%s historical windows must not sort unbounded history", table)
		case dialect.PG:
			plan = explainPostgresQueryPlan(t, db, query)
			require.Contains(t, plan, table+"_pkey", "%s historical windows must use primary-key keyset order", table)
		default:
			t.Fatalf("unsupported database dialect %s", db.Dialect().Name())
		}
	}
}
