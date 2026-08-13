package queue

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	databasemigrations "github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/stretchr/testify/require"
)

func TestWorkerRequeuesStaleProcessingJobs(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	jobID := uuid.NewString()
	job := &models.Job{
		ID:          jobID,
		Type:        jobTypeMediaCleanup,
		Payload:     "{}",
		Status:      jobStatusProcessing,
		RunAt:       time.Now().UTC().Add(-time.Hour),
		Attempts:    1,
		MaxAttempts: 3,
		LockedAt:    time.Now().UTC().Add(-20 * time.Minute),
		LockedBy:    "dead-worker",
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stored := new(models.Job)
	err = db.NewSelect().Model(stored).Where("id = ?", jobID).Scan(ctx)
	require.NoError(t, err)
	require.Equal(t, jobStatusPending, stored.Status)
	require.True(t, stored.LockedAt.IsZero())
	require.Empty(t, stored.LockedBy)
	require.Equal(t, 1, stored.Attempts)
}

func TestWorkerReconcilesStalePublicationJobsBeforeDispatch(t *testing.T) {
	db := createTestDB(t)
	ctx := t.Context()
	for _, model := range []any{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.ThreadDraft)(nil),
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAuthorization)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	_, err := db.NewInsert().Model(&models.User{ID: "user-recovery", Email: "recovery@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-recovery", Name: "Recovery"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-recovery", WorkspaceID: "workspace-recovery", Platform: "x",
		AccountID: "x-recovery", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	legacyPost := &models.Post{
		ID: "post-worker-recovery", WorkspaceID: "workspace-recovery", CreatedByID: "user-recovery",
		Content: "Legacy recovery", Status: models.PostStatusScheduled,
		ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(legacyPost).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-worker-recovery", PostID: legacyPost.ID,
		SocialAccountID: "account-recovery", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	canonical := &models.Publication{
		ID: "publication-worker-recovery", WorkspaceID: "workspace-recovery", CreatedByID: "user-recovery",
		Title: "Canonical recovery", SourceText: "Canonical recovery", SourceContent: "Canonical recovery",
		Status: models.PublicationStatusScheduled, ScheduledAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(canonical).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-worker-recovery", PublicationID: canonical.ID, SocialAccountID: "account-recovery",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Canonical recovery",
		Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	lockedAt := now.Add(-staleProcessingJobAge - time.Minute)
	jobs := []models.Job{
		{ID: "job-legacy-worker-recovery", Type: jobTypePublishPost, Payload: `{"post_id":"post-worker-recovery"}`, Status: jobStatusProcessing, RunAt: now.Add(time.Hour), LockedAt: lockedAt, LockedBy: "dead-worker"},
		{ID: "job-canonical-worker-recovery", Type: jobTypePublishPublication, ScopeID: canonical.ID, Payload: `{"publication_id":"publication-worker-recovery"}`, Status: jobStatusProcessing, RunAt: now.Add(time.Hour), LockedAt: lockedAt, LockedBy: "dead-worker"},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-recovery"}
	requeuedPublicationJobIDs := worker.requeueStaleProcessingJobs(ctx)
	require.ElementsMatch(t, []string{jobs[0].ID, jobs[1].ID}, requeuedPublicationJobIDs)
	var prematurelyClaimed models.Job
	err = db.NewRaw(`UPDATE jobs SET status = ? WHERE id = ? AND status = ? RETURNING *`,
		jobStatusProcessing, jobs[0].ID, jobStatusPending).Scan(ctx, &prematurelyClaimed)
	require.Error(t, err, "stale publication jobs must remain unclaimable before reconciliation commits")
	require.NoError(t, databasemigrations.ReconcileActiveLegacyPublicationJobs(ctx, db, requeuedPublicationJobIDs))

	for index := range jobs {
		require.NoError(t, db.NewSelect().Model(&jobs[index]).Where("id = ?", jobs[index].ID).Scan(ctx))
		require.Equal(t, jobStatusPending, jobs[index].Status)
		require.Equal(t, jobTypePublishPublication, jobs[index].Type)
		require.Contains(t, jobs[index].Payload, "authorization_batch_id")
		receiptCount, countErr := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
			Where("job_id = ?", jobs[index].ID).Count(ctx)
		require.NoError(t, countErr)
		require.Positive(t, receiptCount)
	}
	require.NoError(t, db.NewSelect().Model(legacyPost).Where("id = ?", legacyPost.ID).Scan(ctx))
	require.Equal(t, "legacy-publication:"+legacyPost.ID, legacyPost.PublicationID)
}

func TestWorkerMarksStaleProviderWriteAmbiguousBeforeRequeue(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	job := &models.Job{
		ID: uuid.NewString(), Type: jobTypePublishPublication, Payload: "{}",
		Status: jobStatusProcessing, RunAt: now.Add(-time.Hour), MaxAttempts: 3,
		LockedAt: now.Add(-20 * time.Minute), LockedBy: "dead-worker",
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(job).Exec(ctx)
		return err
	}())
	attempt := &models.ProviderWriteAttempt{
		ID: uuid.NewString(), OperationID: "operation-stale", AttemptNumber: 1,
		JobID: job.ID, WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		TargetKey: "x", Provider: "x", Operation: "publish",
		PayloadFingerprint: "sha256:payload", Status: "sending", SubmissionState: "unknown",
		RetrySafety: "never", CreatedAt: now.Add(-20 * time.Minute), UpdatedAt: now.Add(-20 * time.Minute),
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(attempt).Exec(ctx)
		return err
	}())

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	requeuedPublicationJobIDs := worker.requeueStaleProcessingJobs(ctx)
	require.Equal(t, []string{job.ID}, requeuedPublicationJobIDs)

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(ctx))
	require.Equal(t, jobStatusProcessing, job.Status, "publication work remains unclaimable until exact reconciliation commits")
	require.NoError(t, db.NewSelect().Model(attempt).WherePK().Scan(ctx))
	require.Equal(t, "ambiguous", attempt.Status)
	require.Equal(t, "unknown", attempt.SubmissionState)
	require.Equal(t, "worker_interrupted", attempt.SafeErrorClass)
}

func TestWorkerNeverRequeuesAmbiguousCommunicationsWrites(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	job, err := jobregistry.NewJob(jobregistry.TypeMessageSend, `{"id":"message-1"}`, now.Add(-time.Hour))
	require.NoError(t, err)
	job.Status = jobStatusProcessing
	job.LockedAt = now.Add(-20 * time.Minute)
	job.LockedBy = "dead-worker"
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(ctx))
	require.Equal(t, jobStatusFailed, job.Status)
	require.Contains(t, job.LastError, "did not retry")
}

func TestWorkerKeepsRecentProcessingJobsLocked(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	jobID := uuid.NewString()
	lockedAt := time.Now().UTC().Add(-5 * time.Minute)
	job := &models.Job{
		ID:          jobID,
		Type:        jobTypePublishPost,
		Payload:     "{}",
		Status:      jobStatusProcessing,
		RunAt:       time.Now().UTC().Add(-time.Hour),
		Attempts:    0,
		MaxAttempts: 3,
		LockedAt:    lockedAt,
		LockedBy:    "active-worker",
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stored := new(models.Job)
	err = db.NewSelect().Model(stored).Where("id = ?", jobID).Scan(ctx)
	require.NoError(t, err)
	require.Equal(t, jobStatusProcessing, stored.Status)
	require.False(t, stored.LockedAt.IsZero())
	require.Equal(t, "active-worker", stored.LockedBy)
}

func TestWorkerRecoversTheSameMediaCleanupChainAfterCrash(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	job := &models.Job{
		ID: "cleanup-chain", Type: jobTypeMediaCleanup,
		ScopeID: "workspace-1", DedupeKey: "daily",
		Payload: `{"workspace_id":"workspace-1","days":14}`,
		Status:  jobregistry.StatusProcessing, RunAt: time.Now().UTC().Add(-time.Hour),
		LockedAt: time.Now().UTC().Add(-20 * time.Minute), LockedBy: "dead-worker",
		MaxAttempts: 3,
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	var rows []models.Job
	require.NoError(t, db.NewSelect().Model(&rows).
		Where("type = ? AND scope_id = ? AND dedupe_key = ?", jobTypeMediaCleanup, "workspace-1", "daily").
		Scan(ctx))
	require.Len(t, rows, 1)
	require.Equal(t, "cleanup-chain", rows[0].ID)
	require.Equal(t, jobStatusPending, rows[0].Status)
	require.True(t, rows[0].LockedAt.IsZero())
}

func TestMediaCleanupChainSurvivesExhaustedOperationalRetries(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	job := &models.Job{
		ID: "cleanup-chain", Type: jobTypeMediaCleanup,
		ScopeID: "workspace-1", DedupeKey: "daily",
		Payload: `{"workspace_id":"workspace-1","days":14}`,
		Status:  jobStatusPending, RunAt: time.Now().UTC().Add(-time.Minute), MaxAttempts: 1,
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	require.True(t, worker.processNextJobIfAvailable(ctx))

	var stored models.Job
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, jobStatusPending, stored.Status)
	require.Zero(t, stored.Attempts)
	require.NotEmpty(t, stored.LastError)
	require.WithinDuration(t, time.Now().UTC().Add(24*time.Hour), stored.RunAt, 5*time.Second)
}

func TestWorkerSupersedesStaleAnalyticsSweepWhenSuccessorIsPending(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	_, err := db.NewCreateIndex().
		Index("analytics_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'analytics_sweep'").
		Exec(ctx)
	require.NoError(t, err)

	staleID := uuid.NewString()
	for _, job := range []*models.Job{
		{
			ID:          staleID,
			Type:        analyticsservice.JobTypeSweep,
			Payload:     `{"scheduled_for":"2026-07-26T10:00:00Z"}`,
			Status:      jobStatusProcessing,
			RunAt:       time.Now().UTC().Add(-time.Hour),
			MaxAttempts: 3,
			LockedAt:    time.Now().UTC().Add(-20 * time.Minute),
			LockedBy:    "dead-worker",
		},
		{
			ID:          uuid.NewString(),
			Type:        analyticsservice.JobTypeSweep,
			Payload:     `{"scheduled_for":"2026-07-26T10:15:00Z"}`,
			Status:      jobStatusPending,
			RunAt:       time.Now().UTC().Add(time.Minute),
			MaxAttempts: 3,
		},
	} {
		_, err = db.NewInsert().Model(job).Exec(ctx)
		require.NoError(t, err)
	}

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stale := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stale).Where("id = ?", staleID).Scan(ctx))
	require.Equal(t, jobStatusCompleted, stale.Status)
	require.Contains(t, stale.LastError, "later analytics sweep")

	pending, err := db.NewSelect().
		Model((*models.Job)(nil)).
		Where("type = ? AND status = ?", analyticsservice.JobTypeSweep, jobStatusPending).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, pending)
}
